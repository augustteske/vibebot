"""Офлайн-фильтр событий Telegram до передачи текста транспорту."""

from dataclasses import dataclass, replace
from datetime import datetime, timezone
import logging
from typing import Literal, Protocol
from uuid import uuid4

from .pause_state import PauseState


@dataclass(frozen=True)
class ConsentSnapshot:
    """Снимок состояния привязки и согласий для одного чата."""

    chat_id: int
    binding_id: str
    revision: int
    roster_version: int
    active: bool
    roster: frozenset[int]
    accepted_members: frozenset[int]
    policy_version: str
    consent_policy_version: str
    roster_verified: bool
    company_accepted: bool

    @property
    def has_full_consent(self) -> bool:
        """Проверяет подтверждённое согласие компании и всех участников."""
        return (
            bool(self.roster)
            and self.roster_verified
            and self.company_accepted
            and self.policy_version == self.consent_policy_version
            and self.accepted_members == self.roster
        )


@dataclass(frozen=True)
class BindingStatus:
    """Состояние привязки, полученное от сервера или fake transport."""

    phase: Literal["disconnected", "awaiting_consents", "paused", "active", "calibrating"]
    revision: int
    policyVersion: str
    rosterVersion: int


@dataclass(frozen=True)
class CommunicationView:
    """Сводка общения в форме, согласованной с общим контрактом."""

    status: Literal["disconnected", "awaiting_consents", "paused", "calibrating", "open", "insufficient", "error", "published"]
    period: dict[str, str] | None = None
    dataSource: Literal["chat"] | None = None
    profileVersion: int | None = None
    metrics: dict[str, float] | None = None
    recognitionMethod: Literal["lexicon-v1"] | None = None
    comparison: None = None


class TextTransport(Protocol):
    """Контракт подставного или будущего транспорта для текста."""

    async def send_text(self, event: dict[str, object]) -> dict[str, object]:
        """Передаёт разрешённое событие; реализации не должны логировать текст."""

    async def get_binding_status(self, binding_id: str) -> BindingStatus | dict[str, object]:
        """Возвращает состояние привязки или ошибку транспорта."""

    async def get_summary(self, binding_id: str) -> CommunicationView | dict[str, object]:
        """Возвращает сводку общения или ошибку транспорта."""

    async def pause_transport_gap(self, expected_revision: int) -> BindingStatus:
        """Confirms that the server stopped the binding after uncertain delivery."""


class TelegramIntake:
    """Пропускает только новые текстовые события при полном согласии."""

    def __init__(self, consent: ConsentSnapshot, transport: TextTransport, pause_state: PauseState | None = None) -> None:
        self._pause_state = pause_state or PauseState()
        self._consent = replace(consent, active=False) if self._pause_state.stage != "clear" else consent
        self._transport = transport
        self._seen_messages: set[tuple[int, int]] = set()

    def update_consent(self, consent: ConsentSnapshot) -> None:
        """Обновляет состояние привязки после паузы или смены согласий."""
        self._consent = replace(consent, active=False) if self._pause_state.stage != "clear" else consent

    def stop_after_transport_gap(self) -> None:
        """Не передавать новые тексты после неизвестного результата доставки."""
        self._consent = replace(self._consent, active=False)
        self._pause_state.need_pause()

    async def reconcile_pause(self) -> bool:
        """Confirm server pause first; later accept only a distinct manual resume revision."""
        from .http_transport import TransportError

        if self._pause_state.stage == "clear":
            return False
        try:
            status = await self.get_binding_status()
            if isinstance(status, dict):
                return False
            if self._pause_state.stage == "needed":
                if status.phase != "paused":
                    status = await self._transport.pause_transport_gap(status.revision)
                self._pause_state.confirmed(status.revision)
                return False
            if (status.phase == "active" and self._pause_state.pause_revision is not None
                and status.revision > self._pause_state.pause_revision):
                # The server only permits explicit resume with current full consent.
                self._consent = replace(self._consent, active=True, revision=status.revision,
                    policy_version=status.policyVersion, consent_policy_version=status.policyVersion,
                    roster_version=status.rosterVersion)
                self._pause_state.clear()
                return True
        except TransportError:
            return False
        return False

    async def get_binding_status(self) -> BindingStatus | dict[str, object]:
        """Запрашивает статус привязки через текущий транспорт."""
        return await self._transport.get_binding_status(self._consent.binding_id)

    async def get_summary(self) -> CommunicationView | dict[str, object]:
        """Запрашивает сводку общения через текущий транспорт."""
        return await self._transport.get_summary(self._consent.binding_id)

    async def process(self, update: dict[str, object]) -> dict[str, object] | None:
        """Передаёт допустимое новое сообщение и возвращает ответ транспорта."""
        if not self._consent.active:
            return None
        if update.get("update_type") != "message":
            return None
        message = update.get("message")
        if not isinstance(message, dict):
            return None
        chat = message.get("chat")
        sender = message.get("from")
        if not isinstance(chat, dict) or not isinstance(sender, dict):
            return None

        chat_id = chat.get("id")
        sender_id = sender.get("id")
        is_bot = sender.get("is_bot")
        message_id = message.get("message_id")
        sent_at = message.get("date")
        text = message.get("text")
        if (
            type(chat_id) is not int
            or type(sender_id) is not int
            or type(message_id) is not int
            or type(sent_at) is not int
            or is_bot is True
            or not isinstance(text, str)
            or not text.strip()
        ):
            return None
        if chat_id != self._consent.chat_id:
            return None
        message_key = (chat_id, message_id)
        if message_key in self._seen_messages:
            return None

        try:
            sent_at_iso = datetime.fromtimestamp(sent_at, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        except (OverflowError, OSError, ValueError):
            return None
        payload = {
            "eventId": str(uuid4()),
            "expectedRevision": self._consent.revision,
            "chatId": str(chat_id),
            "messageId": str(message_id),
            "senderId": str(sender_id),
            "sentAt": sent_at_iso,
            "text": text,
        }
        from .http_transport import DeliveryUncertainError, PausedError, StaleRevisionError

        try:
            result = await self._transport.send_text(payload)
        except DeliveryUncertainError:
            self.stop_after_transport_gap()
            await self.reconcile_pause()
            logging.getLogger(__name__).warning("Telegram intake requires a confirmed server pause")
            return {"result": "paused"}
        except StaleRevisionError:
            self._consent = replace(self._consent, active=False)
            return {"error": {"code": "STALE_REVISION"}}
        except PausedError:
            self._consent = replace(self._consent, active=False)
            self._seen_messages.add(message_key)
            logging.getLogger(__name__).warning("Telegram intake paused after server rejected event delivery")
            return {"result": "paused"}
        if result.get("error", {}).get("code") == "STALE_REVISION":
            self._consent = replace(self._consent, active=False)
            return result
        if result.get("result") == "paused":
            self._consent = replace(self._consent, active=False)
            logging.getLogger(__name__).warning("Telegram intake paused by server response")
        if result.get("result") in {"accepted", "duplicate", "paused"}:
            self._seen_messages.add(message_key)
        return result
