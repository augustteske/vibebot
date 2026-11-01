"""
Транспорт сообщений.

Пока только FakeTransport — локальные проверки без сети и без реальных endpoint.
Когда Август зафиксирует контракт — добавим HttpTransport с авторизацией из env.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
import time
import uuid


@dataclass
class OutboundEvent:
    """Событие, которое бот хочет отправить на сервер."""
    event_id: str
    chat_id: int
    team_id: str
    message_id: int
    user_id: int
    text: str
    timestamp: float
    event_type: str = "message.new"  # message.new / message.edit / ...

    @classmethod
    def from_message(
        cls,
        chat_id: int,
        team_id: str,
        message_id: int,
        user_id: int,
        text: str,
        timestamp: Optional[float] = None,
    ) -> "OutboundEvent":
        return cls(
            event_id=str(uuid.uuid4()),
            chat_id=chat_id,
            team_id=team_id,
            message_id=message_id,
            user_id=user_id,
            text=text,
            timestamp=timestamp or time.time(),
        )


class Transport(ABC):
    @abstractmethod
    async def send(self, event: OutboundEvent) -> bool:
        """True если сервер принял, False при отказе/ошибке."""
        ...

    @abstractmethod
    def sent_events(self) -> List[OutboundEvent]:
        """Для тестов: что реально ушло."""
        ...


class FakeTransport(Transport):
    """Локальный мок. Ничего никуда не шлёт, только записывает."""

    def __init__(self) -> None:
        self._sent: List[OutboundEvent] = []
        self.should_fail: bool = False
        self.fail_reason: str = "server_error"

    async def send(self, event: OutboundEvent) -> bool:
        if self.should_fail:
            return False
        self._sent.append(event)
        return True

    def sent_events(self) -> List[OutboundEvent]:
        return list(self._sent)

    def clear(self) -> None:
        self._sent.clear()
        self.should_fail = False


class NullTransport(Transport):
    """Глушилка: всегда «успех», но ничего не сохраняет. Для жёсткой паузы."""

    async def send(self, event: OutboundEvent) -> bool:
        return True

    def sent_events(self) -> List[OutboundEvent]:
        return []