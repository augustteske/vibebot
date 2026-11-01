"""
Состояния согласия и паузы для группового чата.

Правила (из контракта / ILIAN1):
- До подтверждения состава и всех согласий тексты НЕ сохраняем и НЕ передаём.
- При новом/неизвестном участнике, отказе или отзыве — пауза ВСЕГО чата.
- Два согласившихся из неполного состава НЕ включают анализ.
- Личный /stop демо-чек-ина не является отзывом корпоративного согласия.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, Optional, Set
import time


class ChatState(str, Enum):
    """Высокоуровневое состояние чата относительно анализа."""
    UNLINKED = "unlinked"          # ещё не привязан к команде
    PENDING_CONSENT = "pending"    # ждём согласия всех известных участников
    ACTIVE = "active"              # можно принимать и отправлять тексты
    PAUSED = "paused"              # отказ / новый участник / отзыв / неизвестный
    REVOKED = "revoked"            # полный отзыв / отключение


@dataclass
class ParticipantConsent:
    user_id: int
    username: Optional[str] = None
    consented: bool = False
    consented_at: Optional[float] = None
    revoked_at: Optional[float] = None
    is_known: bool = True          # False → неизвестный → сразу пауза


@dataclass
class ChatConsentState:
    """Изолированное состояние одного тестового чата."""
    chat_id: int
    team_id: Optional[str] = None
    state: ChatState = ChatState.UNLINKED
    participants: Dict[int, ParticipantConsent] = field(default_factory=dict)
    initiator_id: Optional[int] = None
    linked_at: Optional[float] = None
    paused_reason: Optional[str] = None
    min_required_consents: int = 2   # для MVP тестового чата; сервер может ужесточить
    last_updated: float = field(default_factory=time.time)

    def mark_updated(self) -> None:
        self.last_updated = time.time()

    def add_or_update_participant(
        self,
        user_id: int,
        username: Optional[str] = None,
        is_known: bool = True,
    ) -> ParticipantConsent:
        if user_id not in self.participants:
            self.participants[user_id] = ParticipantConsent(
                user_id=user_id,
                username=username,
                is_known=is_known,
            )
        else:
            p = self.participants[user_id]
            if username:
                p.username = username
            p.is_known = is_known
        self.mark_updated()
        return self.participants[user_id]

    def set_consent(self, user_id: int, consented: bool) -> None:
        p = self.add_or_update_participant(user_id)
        p.consented = consented
        if consented:
            p.consented_at = time.time()
            p.revoked_at = None
        else:
            p.revoked_at = time.time()
        self._recompute_state()
        self.mark_updated()

    def revoke(self, user_id: int, reason: str = "user_revoke") -> None:
        self.set_consent(user_id, False)
        self.state = ChatState.PAUSED
        self.paused_reason = reason
        self.mark_updated()

    def mark_unknown_participant(self, user_id: int) -> None:
        """Неизвестный участник → немедленная пауза всего чата."""
        self.add_or_update_participant(user_id, is_known=False)
        self.state = ChatState.PAUSED
        self.paused_reason = f"unknown_participant:{user_id}"
        self.mark_updated()

    def link_to_team(self, team_id: str, initiator_id: int) -> None:
        self.team_id = team_id
        self.initiator_id = initiator_id
        self.linked_at = time.time()
        if self.state == ChatState.UNLINKED:
            self.state = ChatState.PENDING_CONSENT
        self.mark_updated()

    def _recompute_state(self) -> None:
        """Пересчёт ACTIVE / PENDING / PAUSED."""
        if self.state in (ChatState.UNLINKED, ChatState.REVOKED):
            return

        known = [p for p in self.participants.values() if p.is_known]
        consented = [p for p in known if p.consented]
        has_unknown = any(not p.is_known for p in self.participants.values())
        has_revoked = any(p.revoked_at is not None and not p.consented for p in known)

        if has_unknown or has_revoked:
            self.state = ChatState.PAUSED
            if has_unknown:
                self.paused_reason = "unknown_participant"
            elif has_revoked:
                self.paused_reason = "consent_revoked"
            return

        if len(consented) >= self.min_required_consents and len(consented) == len(known):
            # Все известные согласились и их достаточно
            self.state = ChatState.ACTIVE
            self.paused_reason = None
        else:
            self.state = ChatState.PENDING_CONSENT
            self.paused_reason = None

    @property
    def can_accept_messages(self) -> bool:
        """Главный гейт: можно ли вообще принимать и отправлять тексты."""
        return self.state == ChatState.ACTIVE

    @property
    def consented_count(self) -> int:
        return sum(1 for p in self.participants.values() if p.consented and p.is_known)

    @property
    def known_count(self) -> int:
        return sum(1 for p in self.participants.values() if p.is_known)

    def status_summary(self) -> dict:
        return {
            "chat_id": self.chat_id,
            "team_id": self.team_id,
            "state": self.state.value,
            "consented": self.consented_count,
            "known": self.known_count,
            "paused_reason": self.paused_reason,
            "can_accept_messages": self.can_accept_messages,
        }


class ConsentRegistry:
    """In-memory реестр состояний чатов (для MVP / тестов)."""

    def __init__(self) -> None:
        self._chats: Dict[int, ChatConsentState] = {}

    def get(self, chat_id: int) -> ChatConsentState:
        if chat_id not in self._chats:
            self._chats[chat_id] = ChatConsentState(chat_id=chat_id)
        return self._chats[chat_id]

    def reset(self, chat_id: int) -> None:
        if chat_id in self._chats:
            del self._chats[chat_id]