"""Офлайн-фильтр событий Telegram до передачи текста транспорту."""

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class ConsentSnapshot:
    """Снимок состояния привязки и согласий для одного чата."""

    chat_id: int
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


class TextTransport(Protocol):
    """Контракт подставного или будущего транспорта для текста."""

    def send_text(self, event: dict[str, object]) -> object:
        """Передаёт разрешённое событие; реализации не должны логировать текст."""


class TelegramIntake:
    """Пропускает только новые текстовые события при полном согласии."""

    def __init__(self, consent: ConsentSnapshot, transport: TextTransport) -> None:
        self._consent = consent
        self._transport = transport
        self._seen_messages: set[tuple[int, int]] = set()

    def update_consent(self, consent: ConsentSnapshot) -> None:
        """Обновляет состояние привязки после паузы или смены согласий."""
        self._consent = consent

    def process(self, event: dict[str, object]) -> bool:
        """Передаёт допустимое новое сообщение и возвращает факт передачи."""
        if not self._consent.active or not self._consent.has_full_consent:
            return False
        if event.get("update_type") != "message":
            return False

        chat_id = event.get("chat_id")
        sender_id = event.get("sender_id")
        message_id = event.get("message_id")
        text = event.get("text")
        if (
            type(chat_id) is not int
            or type(sender_id) is not int
            or type(message_id) is not int
            or not isinstance(text, str)
            or not text.strip()
        ):
            return False
        if chat_id != self._consent.chat_id or sender_id not in self._consent.roster:
            return False

        message_key = (chat_id, message_id)
        if message_key in self._seen_messages:
            return False

        self._seen_messages.add(message_key)
        self._transport.send_text(event)
        return True
