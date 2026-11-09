import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from bot.__main__ import create_dispatcher
from bot import i18n


class FakeMessage:
    def __init__(self, text="", user_id=42, chat_type="private"):
        self.chat = SimpleNamespace(id=user_id, type=chat_type)
        self.from_user = SimpleNamespace(id=user_id, is_bot=False, first_name="Тест")
        self.text = text
        self.answer = AsyncMock()


def handler(observer, name):
    return next(item.callback for item in observer.handlers if item.callback.__name__ == name)


class QuickMenuTests(unittest.IsolatedAsyncioTestCase):
    async def test_start_and_menu_commands_send_inline_quick_menu(self):
        dispatcher, _ = create_dispatcher()
        message_start = FakeMessage(text="/start")
        message_menu = FakeMessage(text="/menu")

        # Test /start
        await handler(dispatcher.message, "start")(message_start)
        message_start.answer.assert_awaited_once()
        text_start = message_start.answer.await_args.args[0]
        keyboard_start = message_start.answer.await_args.kwargs["reply_markup"]
        callbacks_start = [btn.callback_data for row in keyboard_start.inline_keyboard for btn in row]

        self.assertIn("menu:checkin", callbacks_start)
        self.assertIn("menu:stats", callbacks_start)
        self.assertIn("menu:achievements", callbacks_start)
        self.assertIn("menu:leader_message", callbacks_start)
        self.assertIn("menu:guide", callbacks_start)
        self.assertIn("menu:settings", callbacks_start)

        buttons_text = [btn.text for row in keyboard_start.inline_keyboard for btn in row]
        self.assertTrue(any("Мой статус" in t or "My status" in t for t in buttons_text))
        self.assertTrue(any("Достижения" in t or "Achievements" in t for t in buttons_text))
        self.assertTrue(any("Обратиться к тимлиду" in t or "Message Team Lead" in t for t in buttons_text))
        self.assertTrue(any("Как подключить?" in t or "How to connect?" in t for t in buttons_text))
        self.assertTrue(any("Настройки" in t or "Settings" in t for t in buttons_text))

        # Test /menu
        await handler(dispatcher.message, "menu_command")(message_menu)
        message_menu.answer.assert_awaited_once()
        keyboard_menu = message_menu.answer.await_args.kwargs["reply_markup"]
        callbacks_menu = [btn.callback_data for row in keyboard_menu.inline_keyboard for btn in row]
        self.assertEqual(callbacks_start, callbacks_menu)

    async def test_menu_stats_callback_triggers_stats(self):
        dispatcher, _ = create_dispatcher()
        message = FakeMessage()
        event = SimpleNamespace(
            message=message,
            from_user=message.from_user,
            data="menu:stats",
            answer=AsyncMock(),
        )

        await handler(dispatcher.callback_query, "select_stats")(event)
        event.answer.assert_awaited_once()
        message.answer.assert_awaited_once()

    async def test_menu_achievements_callback_triggers_achievements(self):
        dispatcher, _ = create_dispatcher()
        message = FakeMessage()
        event = SimpleNamespace(
            message=message,
            from_user=message.from_user,
            data="menu:achievements",
            answer=AsyncMock(),
        )

        await handler(dispatcher.callback_query, "select_achievements")(event)
        event.answer.assert_awaited_once()
        message.answer.assert_awaited_once()

    async def test_menu_guide_callback_sends_guide_link(self):
        dispatcher, _ = create_dispatcher()
        message = FakeMessage()
        event = SimpleNamespace(
            message=message,
            from_user=message.from_user,
            data="menu:guide",
            answer=AsyncMock(),
        )

        await handler(dispatcher.callback_query, "select_guide")(event)
        event.answer.assert_awaited_once()
        message.answer.assert_awaited_once()
        guide_text = message.answer.await_args.args[0]
        self.assertTrue("guide" in guide_text.lower() or "инструкц" in guide_text.lower() or "http" in guide_text)
        guide_keyboard = message.answer.await_args.kwargs["reply_markup"]
        guide_url_buttons = [btn for row in guide_keyboard.inline_keyboard for btn in row if btn.url]
        self.assertTrue(len(guide_url_buttons) >= 1)

    async def test_menu_settings_callback_shows_language_and_style_options(self):
        dispatcher, _ = create_dispatcher()
        message = FakeMessage()
        event = SimpleNamespace(
            message=message,
            from_user=message.from_user,
            data="menu:settings",
            answer=AsyncMock(),
        )

        await handler(dispatcher.callback_query, "select_settings")(event)
        event.answer.assert_awaited_once()
        message.answer.assert_awaited_once()
        settings_text = message.answer.await_args.args[0]
        self.assertTrue("настройк" in settings_text.lower() or "settings" in settings_text.lower())
        settings_keyboard = message.answer.await_args.kwargs["reply_markup"]
        callbacks = [btn.callback_data for row in settings_keyboard.inline_keyboard for btn in row]
        self.assertTrue(any(c.startswith("lang:") for c in callbacks))
        self.assertTrue(any(c.startswith("style:") for c in callbacks))

    async def test_menu_leader_message_callback_prompts_message_input(self):
        dispatcher, _ = create_dispatcher()
        message = FakeMessage()
        event = SimpleNamespace(
            message=message,
            from_user=message.from_user,
            data="menu:leader_message",
            answer=AsyncMock(),
        )

        await handler(dispatcher.callback_query, "select_leader_message")(event)
        event.answer.assert_awaited_once()
        message.answer.assert_awaited_once()
        prompt_text = message.answer.await_args.args[0]
        self.assertTrue("обращени" in prompt_text.lower() or "message" in prompt_text.lower())
