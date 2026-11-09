import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from bot.__main__ import create_dispatcher
from bot import i18n, styles


class FakeMessage:
    def __init__(self, text="", user_id=42, chat_type="private"):
        self.chat = SimpleNamespace(id=user_id, type=chat_type)
        self.from_user = SimpleNamespace(id=user_id, is_bot=False)
        self.text = text
        self.answer = AsyncMock()


def handler(observer, name):
    return next(item.callback for item in observer.handlers if item.callback.__name__ == name)


class OnboardingBotTests(unittest.IsolatedAsyncioTestCase):
    async def test_start_suggests_connecting_team_with_room_key(self):
        dispatcher, _ = create_dispatcher()
        message = FakeMessage()

        await handler(dispatcher.message, "start")(message)

        text = message.answer.await_args.args[0]
        self.assertIn("Привет! Я Vibee", text)
        self.assertIn("Хочешь подключить свою команду?", text)
        self.assertIn("A1B2C3D4", text)

    async def test_sending_room_key_connects_team_in_private_chat(self):
        dispatcher, _ = create_dispatcher()
        message = FakeMessage(text="A1B2C3D4")
        state = AsyncMock()

        await handler(dispatcher.message, "intake_message")(message, state)

        message.answer.assert_awaited_once()
        reply = message.answer.await_args.args[0]
        self.assertIn("Отлично! Теперь ты в команде.", reply)
        self.assertIn("мы начнем собирать метрики", reply)
        state.update_data.assert_awaited_once_with(room_key="A1B2C3D4")

    async def test_sending_lowercase_room_key_normalizes_to_uppercase(self):
        dispatcher, _ = create_dispatcher()
        message = FakeMessage(text="a1b2c3d4")
        state = AsyncMock()

        await handler(dispatcher.message, "intake_message")(message, state)

        message.answer.assert_awaited_once()
        reply = message.answer.await_args.args[0]
        self.assertIn("Отлично! Теперь ты в команде", reply)
        state.update_data.assert_awaited_once_with(room_key="A1B2C3D4")

    async def test_sending_key_with_prefix_works(self):
        dispatcher, _ = create_dispatcher()
        message = FakeMessage(text="Ключ: A1B2C3D4")
        state = AsyncMock()

        await handler(dispatcher.message, "intake_message")(message, state)

        message.answer.assert_awaited_once()
        state.update_data.assert_awaited_once_with(room_key="A1B2C3D4")

    async def test_room_command_with_key(self):
        dispatcher, _ = create_dispatcher()
        message = FakeMessage(text="/room A1B2C3D4")
        state = AsyncMock()

        await handler(dispatcher.message, "room_command")(message, state)

        message.answer.assert_awaited_once()
        reply = message.answer.await_args.args[0]
        self.assertIn("Отлично! Теперь ты в команде", reply)
        state.update_data.assert_awaited_once_with(room_key="A1B2C3D4")
