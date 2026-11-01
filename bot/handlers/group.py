"""
Обработка групповых сообщений и согласий.

Главный инвариант: без ACTIVE состояния тексты не уходят в transport.
"""

from __future__ import annotations

from typing import Optional

from bot.consent import ConsentRegistry, ChatState
from bot.transport import Transport, OutboundEvent


class GroupMessageGate:
    """
    Гейт перед отправкой.
    Используй его и в реальных хендлерах aiogram, и в тестах.
    """

    def __init__(
        self,
        registry: ConsentRegistry,
        transport: Transport,
    ) -> None:
        self.registry = registry
        self.transport = transport

    async def handle_new_text(
        self,
        chat_id: int,
        message_id: int,
        user_id: int,
        text: str,
        username: Optional[str] = None,
    ) -> dict:
        """
        Возвращает результат попытки обработки.
        Никогда не отправляет текст, если чат не ACTIVE.
        """
        state = self.registry.get(chat_id)

        # Неизвестный участник → пауза
        if user_id not in state.participants or not state.participants[user_id].is_known:
            state.mark_unknown_participant(user_id)
            return {
                "accepted": False,
                "reason": "unknown_or_new_participant",
                "state": state.status_summary(),
            }

        if not state.can_accept_messages:
            return {
                "accepted": False,
                "reason": f"chat_not_active:{state.state.value}",
                "state": state.status_summary(),
            }

        if not state.team_id:
            return {
                "accepted": False,
                "reason": "no_team_linked",
                "state": state.status_summary(),
            }

        event = OutboundEvent.from_message(
            chat_id=chat_id,
            team_id=state.team_id,
            message_id=message_id,
            user_id=user_id,
            text=text,
        )

        ok = await self.transport.send(event)
        return {
            "accepted": ok,
            "reason": "sent" if ok else "transport_failed",
            "event_id": event.event_id if ok else None,
            "state": state.status_summary(),
        }

    def link_chat(self, chat_id: int, team_id: str, initiator_id: int) -> dict:
        state = self.registry.get(chat_id)
        state.link_to_team(team_id, initiator_id)
        # Инициатор автоматически помечается известным
        state.add_or_update_participant(initiator_id, is_known=True)
        return state.status_summary()

    def grant_consent(self, chat_id: int, user_id: int) -> dict:
        state = self.registry.get(chat_id)
        state.set_consent(user_id, True)
        return state.status_summary()

    def revoke_consent(self, chat_id: int, user_id: int) -> dict:
        state = self.registry.get(chat_id)
        state.revoke(user_id)
        return state.status_summary()