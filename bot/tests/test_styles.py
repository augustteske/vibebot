"""Режимы общения: /style, сохранение выбора и защита групп от крепких слов."""
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from bot import i18n, styles
from bot.__main__ import create_dispatcher


class FakeState:
    def __init__(self, data=None):
        self.data = dict(data or {})

    async def get_data(self):
        return dict(self.data)

    async def update_data(self, **kwargs):
        self.data.update(kwargs)


class FakeMessage:
    def __init__(self, user_id=41, chat_type="private"):
        self.chat = SimpleNamespace(id=user_id, type=chat_type)
        self.from_user = SimpleNamespace(id=user_id, is_bot=False)
        self.text = ""
        self.answer = AsyncMock()


def handler(observer, name):
    return next(item.callback for item in observer.handlers if item.callback.__name__ == name)


def event(message, data):
    return SimpleNamespace(
        message=message, from_user=message.from_user, data=data, answer=AsyncMock(),
    )


async def open_first_question(dispatcher, message, state):
    await handler(dispatcher.message, "start")(message, state)
    await handler(dispatcher.callback_query, "select_checkin")(event(message, "menu:checkin"), state)
    nonce = message.answer.await_args.kwargs["reply_markup"].inline_keyboard[0][0].callback_data.split(":")[1]
    await handler(dispatcher.callback_query, "callback")(event(message, f"consent:{nonce}:yes"), state)
    return nonce


class StyleRulesTests(unittest.TestCase):
    def test_normalization_and_group_guard(self):
        self.assertEqual(styles.normalize_style(" CUTE "), styles.CUTE)
        self.assertIsNone(styles.normalize_style("loud"))
        self.assertIsNone(styles.normalize_style(None))
        self.assertEqual(styles.for_chat(styles.STRAIGHT, "private"), styles.STRAIGHT)
        self.assertEqual(styles.for_chat(styles.CUTE, "supergroup"), styles.CLASSIC)
        self.assertEqual(styles.for_chat("weird", "private"), styles.CLASSIC)

    def test_straight_language_is_private_and_translated(self):
        self.assertIn("нахер", i18n.styled_text(i18n.RU, styles.STRAIGHT, "start.private"))
        self.assertEqual(i18n.style_name(i18n.EN, styles.STRAIGHT), "Straight talk")
        self.assertEqual(i18n.style_name(i18n.RU, styles.CUTE), "Ми-ми-ми")
        self.assertNotEqual(
            i18n.styled_text(i18n.EN, styles.CUTE, "start.private"),
            i18n.styled_text(i18n.RU, styles.CUTE, "start.private"),
        )

    def test_group_style_falls_back_to_classic_text(self):
        group_style = styles.for_chat(styles.STRAIGHT, "group")
        self.assertEqual(
            i18n.styled_text(i18n.RU, group_style, "start.private"),
            i18n.text(i18n.RU, "start.private"),
        )

    def test_every_mode_has_its_own_text(self):
        for language in i18n.LANGUAGES:
            for style in (styles.CUTE, styles.STRAIGHT):
                for key in ("start.private", "question.ask", "checkin.done.server"):
                    self.assertNotEqual(
                        i18n.styled_text(language, style, key, index=1, total=3, question="Q"),
                        i18n.text(language, key, index=1, total=3, question="Q"),
                    )


class StyleCommandTests(unittest.IsolatedAsyncioTestCase):
    async def test_style_shows_three_modes_and_the_current_choice(self):
        dispatcher, _ = create_dispatcher()
        state = FakeState()
        message = FakeMessage()
        message.text = "/style"

        await handler(dispatcher.message, "style_command")(message, state)

        text = message.answer.await_args.args[0]
        buttons = message.answer.await_args.kwargs["reply_markup"].inline_keyboard[0]
        self.assertIn("Классик", text)
        self.assertEqual(
            [button.callback_data for button in buttons],
            ["style:classic", "style:cute", "style:straight"],
        )
        self.assertIn("✓", buttons[0].text)

    async def test_style_button_saves_choice_and_questions_follow_it(self):
        dispatcher, _ = create_dispatcher()
        state = FakeState()
        message = FakeMessage()

        await handler(dispatcher.callback_query, "style_callback")(
            event(message, "style:cute"), state,
        )
        self.assertEqual(state.data["style"], "cute")
        self.assertIn("💛", message.answer.await_args.args[0])

        await open_first_question(dispatcher, message, state)
        self.assertIn("как чувствуешь", message.answer.await_args.args[0])

    async def test_straight_mode_works_in_private_and_classic_switches_back(self):
        dispatcher, _ = create_dispatcher()
        state = FakeState()
        message = FakeMessage()
        message.text = "/style straight"

        await handler(dispatcher.message, "style_command")(message, state)
        self.assertEqual(state.data["style"], "straight")
        self.assertIn("Правдарубка", message.answer.await_args.args[0])

        await handler(dispatcher.message, "start")(message, state)
        self.assertIn("нахер", message.answer.await_args.args[0])

        message.text = "/style classic"
        await handler(dispatcher.message, "style_command")(message, state)
        self.assertEqual(state.data["style"], "classic")
        self.assertNotIn("нахер", message.answer.await_args.args[0])

    async def test_unknown_mode_is_rejected(self):
        dispatcher, _ = create_dispatcher()
        state = FakeState()
        message = FakeMessage()
        message.text = "/style shouty"

        await handler(dispatcher.message, "style_command")(message, state)

        self.assertNotIn("style", state.data)
        self.assertIn("Не знаю такого режима", message.answer.await_args.args[0])

    async def test_group_cannot_change_the_style(self):
        dispatcher, _ = create_dispatcher()
        state = FakeState()
        message = FakeMessage(chat_type="group")
        message.text = "/style straight"

        await handler(dispatcher.message, "style_command")(message, state)

        self.assertNotIn("style", state.data)
        self.assertIn("только в личном чате", message.answer.await_args.args[0])

    async def test_group_style_button_is_rejected(self):
        dispatcher, _ = create_dispatcher()
        state = FakeState()
        message = FakeMessage(chat_type="group")
        button = event(message, "style:straight")

        await handler(dispatcher.callback_query, "style_callback")(button, state)

        self.assertNotIn("style", state.data)
        self.assertTrue(button.answer.await_args.kwargs["show_alert"])
        self.assertIn("только в личном чате", button.answer.await_args.args[0])

    async def test_group_start_never_uses_straight_text(self):
        dispatcher, _ = create_dispatcher()
        state = FakeState({"style": "straight"})
        message = FakeMessage(chat_type="supergroup")

        await handler(dispatcher.message, "start")(message, state)

        text = message.answer.await_args.args[0]
        self.assertNotIn("нахер", text)
        self.assertNotIn("Привет. Vibee", text)
        self.assertIn("не настроен", text)


if __name__ == "__main__":
    unittest.main()
