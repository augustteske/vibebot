import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from bot.__main__ import create_dispatcher
from bot.http_transport import HttpTransport


class FakeMessage:
    def __init__(self, text=""):
        self.text = text
        self.chat = SimpleNamespace(id=123, type="private")
        self.from_user = SimpleNamespace(id=456, first_name="Тест", last_name="Юзер", username="testuser", is_bot=False)
        self.answer = AsyncMock()


def find_handler(handlers, name):
    for h in handlers:
        callback = getattr(h, "callback", None)
        if getattr(callback, "__name__", "") == name:
            return callback
    raise ValueError(f"Handler {name} not found")


class LeaderMessageTests(unittest.IsolatedAsyncioTestCase):
    async def test_help_contains_leader_message_button(self):
        dispatcher, _ = create_dispatcher()
        message = FakeMessage()
        handler = find_handler(dispatcher.message.handlers, "help_command")
        await handler(message)
        keyboard = message.answer.await_args.kwargs["reply_markup"]
        callbacks = [btn.callback_data for row in keyboard.inline_keyboard for btn in row if btn.callback_data]
        self.assertIn("menu:leader_message", callbacks)

    async def test_leader_message_flow_anonymous(self):
        mock_transport = AsyncMock(spec=HttpTransport)
        mock_transport.submit_leader_message = AsyncMock(return_value={"id": "msg-1"})

        dispatcher, _ = create_dispatcher(checkin_transport=mock_transport)
        message = FakeMessage()

        # Step 1: Click menu button
        select_handler = find_handler(dispatcher.callback_query.handlers, "select_leader_message")
        event = SimpleNamespace(
            message=message,
            from_user=message.from_user,
            data="menu:leader_message",
            answer=AsyncMock(),
        )
        await select_handler(event)
        self.assertIn("Напишите текст", message.answer.await_args.args[0])

        # Step 2: Send text in private chat
        message.text = "Коллеги, у нас проблемы со спринтом"
        intake_handler = find_handler(dispatcher.message.handlers, "intake_message")
        await intake_handler(message)

        prompt_text = message.answer.await_args.args[0]
        self.assertIn("Как вы хотите отправить", prompt_text)
        keyboard = message.answer.await_args.kwargs["reply_markup"]
        btn_callbacks = [btn.callback_data for row in keyboard.inline_keyboard for btn in row]
        self.assertIn("leadermsg:anon", btn_callbacks)
        self.assertIn("leadermsg:open", btn_callbacks)

        # Step 3: Choose anonymous
        submit_handler = find_handler(dispatcher.callback_query.handlers, "submit_leader_message_callback")
        anon_event = SimpleNamespace(
            message=message,
            from_user=message.from_user,
            data="leadermsg:anon",
            answer=AsyncMock(),
        )
        await submit_handler(anon_event)

        mock_transport.submit_leader_message.assert_awaited_once_with(
            message="Коллеги, у нас проблемы со спринтом",
            is_anonymous=True,
            telegram_user_id=456,
            sender_name=None,
        )
        confirm_text = message.answer.await_args.args[0]
        self.assertIn("анонимное обращение успешно передано", confirm_text)

    async def test_leader_message_flow_open(self):
        mock_transport = AsyncMock(spec=HttpTransport)
        mock_transport.submit_leader_message = AsyncMock(return_value={"id": "msg-2"})

        dispatcher, _ = create_dispatcher(checkin_transport=mock_transport)
        message = FakeMessage()

        select_handler = find_handler(dispatcher.callback_query.handlers, "select_leader_message")
        event = SimpleNamespace(
            message=message,
            from_user=message.from_user,
            data="menu:leader_message",
            answer=AsyncMock(),
        )
        await select_handler(event)

        message.text = "Хочу обсудить повышение"
        intake_handler = find_handler(dispatcher.message.handlers, "intake_message")
        await intake_handler(message)

        submit_handler = find_handler(dispatcher.callback_query.handlers, "submit_leader_message_callback")
        open_event = SimpleNamespace(
            message=message,
            from_user=message.from_user,
            data="leadermsg:open",
            answer=AsyncMock(),
        )
        await submit_handler(open_event)

        mock_transport.submit_leader_message.assert_awaited_once_with(
            message="Хочу обсудить повышение",
            is_anonymous=False,
            telegram_user_id=456,
            sender_name="Тест Юзер",
        )
        confirm_text = message.answer.await_args.args[0]
        self.assertIn("с указанием имени успешно передано", confirm_text)


if __name__ == "__main__":
    unittest.main()
