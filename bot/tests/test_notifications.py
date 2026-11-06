from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock

from bot.__main__ import create_dispatcher


class FakeNotificationTransport:
    def __init__(self):
        self.user_ids = []

    async def subscribe_notifications(self, telegram_user_id):
        self.user_ids.append(telegram_user_id)
        return {"subscribed": True, "notificationsEnabled": True}


class NotificationCommandTests(unittest.IsolatedAsyncioTestCase):
    def subscribe_handler(self, dispatcher):
        return next(
            handler.callback
            for handler in dispatcher.message.handlers
            if handler.callback.__name__ == "subscribe"
        )

    async def test_private_subscribe_sends_telegram_identity_to_server(self):
        transport = FakeNotificationTransport()
        dispatcher, _ = create_dispatcher(notification_transport=transport)
        message = SimpleNamespace(
            chat=SimpleNamespace(type="private", id=12345),
            from_user=SimpleNamespace(id=12345, is_bot=False),
            answer=AsyncMock(),
        )

        await self.subscribe_handler(dispatcher)(message)

        self.assertEqual(transport.user_ids, [12345])
        message.answer.assert_awaited_once()
        self.assertIn("Подписка включена", message.answer.await_args.args[0])

    async def test_subscribe_ignores_group_messages(self):
        transport = FakeNotificationTransport()
        dispatcher, _ = create_dispatcher(notification_transport=transport)
        message = SimpleNamespace(
            chat=SimpleNamespace(type="group", id=-100),
            from_user=SimpleNamespace(id=12345, is_bot=False),
            answer=AsyncMock(),
        )

        await self.subscribe_handler(dispatcher)(message)

        self.assertEqual(transport.user_ids, [])
        message.answer.assert_not_awaited()

    async def test_subscribe_reports_missing_server_transport(self):
        dispatcher, _ = create_dispatcher()
        message = SimpleNamespace(
            chat=SimpleNamespace(type="private", id=12345),
            from_user=SimpleNamespace(id=12345, is_bot=False),
            answer=AsyncMock(),
        )

        await self.subscribe_handler(dispatcher)(message)

        message.answer.assert_awaited_once()
        self.assertIn("не настроены", message.answer.await_args.args[0])


if __name__ == "__main__":
    unittest.main()
