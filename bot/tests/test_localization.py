"""Язык ответов (/lang) и картинки к вопросам чек-ина."""
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

from aiogram.types import FSInputFile

from bot import i18n
from bot.__main__ import create_dispatcher
from bot.cleanup import SentMessageJournal
from bot.flow import QUESTION_KEYS
from bot.question_images import DEFAULT_IMAGE_DIR, QuestionImageCache


class FakeState:
    def __init__(self, data=None):
        self.data = dict(data or {})

    async def get_data(self):
        return dict(self.data)

    async def update_data(self, **kwargs):
        self.data.update(kwargs)


class FakeBot:
    async def delete_messages(self, chat_id, message_ids):
        return True


class FakeMessage:
    def __init__(self, user_id=41, chat_type="private", photo_file_id="uploaded-file-id"):
        self.chat = SimpleNamespace(id=user_id, type=chat_type)
        self.from_user = SimpleNamespace(id=user_id, is_bot=False)
        self.text = ""
        self.answer = AsyncMock()
        self.answer_photo = AsyncMock(return_value=SimpleNamespace(
            photo=[SimpleNamespace(file_id=photo_file_id)],
        ))
        self.bot = FakeBot()


def handler(observer, name):
    return next(item.callback for item in observer.handlers if item.callback.__name__ == name)


class TranslationCatalogTests(unittest.TestCase):
    def test_every_russian_text_has_an_english_one(self):
        missing = [
            key for key in i18n._TEXTS[i18n.RU]
            if key not in i18n._TEXTS[i18n.EN]
        ]
        self.assertEqual(missing, [])

    def test_question_keys_are_translated(self):
        for key in QUESTION_KEYS:
            self.assertTrue(i18n.question(i18n.RU, key))
            self.assertTrue(i18n.question(i18n.EN, key))
            self.assertNotEqual(i18n.question(i18n.RU, key), i18n.question(i18n.EN, key))

    def test_language_normalization_falls_back_to_russian(self):
        self.assertEqual(i18n.normalize_language("EN"), "en")
        self.assertEqual(i18n.normalize_language(" ru-RU "), "ru")
        self.assertIsNone(i18n.normalize_language("de"))
        self.assertIsNone(i18n.normalize_language(None))
        self.assertEqual(i18n.text("de", "lang.saved"), i18n.text(i18n.RU, "lang.saved"))


class LanguageCommandTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.dispatcher, self.flow = create_dispatcher()
        self.state = FakeState()
        self.message = FakeMessage()

    async def test_lang_without_argument_shows_current_language_and_buttons(self):
        await handler(self.dispatcher.message, "language_command")(self.message, self.state)

        text = self.message.answer.await_args.args[0]
        buttons = self.message.answer.await_args.kwargs["reply_markup"].inline_keyboard[0]
        self.assertIn("русский", text)
        self.assertEqual([button.callback_data for button in buttons], ["lang:ru", "lang:en"])
        self.assertIn("✓", buttons[0].text)

    async def test_lang_switches_greeting_and_questions_to_english(self):
        self.message.text = "/lang en"
        await handler(self.dispatcher.message, "language_command")(self.message, self.state)
        self.assertEqual(self.state.data["lang"], "en")

        await handler(self.dispatcher.message, "start")(self.message, self.state)
        greeting = self.message.answer.await_args.args[0]
        menu = self.message.answer.await_args.kwargs["reply_markup"]
        self.assertIn("Hi! I'm Vibee", greeting)
        self.assertEqual(menu.inline_keyboard[0][0].text, "Take a personal check-in")

        await handler(self.dispatcher.callback_query, "select_checkin")(SimpleNamespace(
            message=self.message, from_user=self.message.from_user,
            data="menu:checkin", answer=AsyncMock(),
        ), self.state)
        consent_text = self.message.answer.await_args.args[0]
        consent_keyboard = self.message.answer.await_args.kwargs["reply_markup"]
        nonce = consent_keyboard.inline_keyboard[0][0].callback_data.split(":")[1]
        self.assertIn("Your consent is required", consent_text)
        self.assertEqual(consent_keyboard.inline_keyboard[0][0].text, "I agree")

        await handler(self.dispatcher.callback_query, "callback")(SimpleNamespace(
            message=self.message, from_user=self.message.from_user,
            data=f"consent:{nonce}:yes", answer=AsyncMock(),
        ), self.state)
        self.assertEqual(
            self.message.answer.await_args.args[0],
            "1/3 · How much energy do you have for work today?\n1 — low, 5 — high. Cancel: /stop.",
        )

    async def test_lang_button_and_invalid_language(self):
        event = SimpleNamespace(
            message=self.message, from_user=self.message.from_user,
            data="lang:en", answer=AsyncMock(),
        )
        await handler(self.dispatcher.callback_query, "language_callback")(event, self.state)
        self.assertEqual(self.state.data["lang"], "en")
        self.assertIn("Language saved", self.message.answer.await_args.args[0])

        event.data = "lang:de"
        await handler(self.dispatcher.callback_query, "language_callback")(event, self.state)
        self.assertEqual(self.state.data["lang"], "en")
        self.assertIn("Unknown language", event.answer.await_args.args[0])

    async def test_clean_uses_the_selected_language(self):
        journal = SentMessageJournal()
        journal.record(41, 1)
        dispatcher, _ = create_dispatcher(message_log=journal)
        state = FakeState({"lang": "en"})
        message = FakeMessage()

        await handler(dispatcher.message, "clean_command")(message, state)

        self.assertIn("Chat cleaned", message.answer.await_args.args[0])
        self.assertNotIn("Чат очищен", message.answer.await_args.args[0])


class QuestionImageTests(unittest.IsolatedAsyncioTestCase):
    def test_assets_exist_for_every_question(self):
        missing = [key for key in QUESTION_KEYS if not (DEFAULT_IMAGE_DIR / f"{key}.png").is_file()]
        self.assertEqual(missing, [])

    def test_cache_survives_restart_and_ignores_broken_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "images.json"
            cache = QuestionImageCache(path)
            cache.remember("energy", "file-1")
            cache.remember("clarity", "file-2")

            reloaded = QuestionImageCache(path)
            self.assertEqual(reloaded.get("energy"), "file-1")
            self.assertEqual(reloaded.get("clarity"), "file-2")
            self.assertIsNone(reloaded.get("support"))

            path.write_text("{not json", encoding="utf-8")
            self.assertEqual(QuestionImageCache(path).file_ids, {})

    async def test_first_question_uploads_the_file_and_the_next_uses_file_id(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = QuestionImageCache(Path(directory) / "images.json")
            dispatcher, flow = create_dispatcher(question_images=cache)
            message = FakeMessage(photo_file_id="telegram-file-id")

            await handler(dispatcher.message, "start")(message)
            await handler(dispatcher.callback_query, "select_checkin")(SimpleNamespace(
                message=message, from_user=message.from_user,
                data="menu:checkin", answer=AsyncMock(),
            ))
            nonce = message.answer.await_args.kwargs["reply_markup"].inline_keyboard[0][0].callback_data.split(":")[1]
            await handler(dispatcher.callback_query, "callback")(SimpleNamespace(
                message=message, from_user=message.from_user,
                data=f"consent:{nonce}:yes", answer=AsyncMock(),
            ))

            first_photo = message.answer_photo.await_args.args[0]
            self.assertIsInstance(first_photo, FSInputFile)
            self.assertEqual(Path(first_photo.path), DEFAULT_IMAGE_DIR / "energy.png")
            self.assertEqual(cache.get("energy"), "telegram-file-id")

            # Второй заход на тот же вопрос берёт file_id, а не грузит файл снова.
            flow.cancel(message.from_user.id)
            await handler(dispatcher.callback_query, "select_checkin")(SimpleNamespace(
                message=message, from_user=message.from_user,
                data="menu:checkin", answer=AsyncMock(),
            ))
            nonce = message.answer.await_args.kwargs["reply_markup"].inline_keyboard[0][0].callback_data.split(":")[1]
            await handler(dispatcher.callback_query, "callback")(SimpleNamespace(
                message=message, from_user=message.from_user,
                data=f"consent:{nonce}:yes", answer=AsyncMock(),
            ))

            self.assertEqual(message.answer_photo.await_args.args[0], "telegram-file-id")
            self.assertEqual(cache.get("energy"), "telegram-file-id")

    async def test_stale_file_id_falls_back_to_the_local_file(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = QuestionImageCache(Path(directory) / "images.json")
            cache.remember("energy", "stale-file-id")
            dispatcher, _ = create_dispatcher(question_images=cache)
            message = FakeMessage()
            message.answer_photo = AsyncMock(side_effect=[
                RuntimeError("file_id is invalid"),
                SimpleNamespace(photo=[SimpleNamespace(file_id="fresh-file-id")]),
            ])

            await handler(dispatcher.message, "start")(message)
            await handler(dispatcher.callback_query, "select_checkin")(SimpleNamespace(
                message=message, from_user=message.from_user,
                data="menu:checkin", answer=AsyncMock(),
            ))
            nonce = message.answer.await_args.kwargs["reply_markup"].inline_keyboard[0][0].callback_data.split(":")[1]
            await handler(dispatcher.callback_query, "callback")(SimpleNamespace(
                message=message, from_user=message.from_user,
                data=f"consent:{nonce}:yes", answer=AsyncMock(),
            ))

            self.assertEqual(message.answer_photo.await_count, 2)
            self.assertIsInstance(message.answer_photo.await_args_list[1].args[0], FSInputFile)
            self.assertEqual(cache.get("energy"), "fresh-file-id")
            self.assertTrue(message.answer.await_args.args[0].startswith("1/3"))

    async def test_failed_photo_does_not_break_the_question(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = QuestionImageCache(Path(directory) / "images.json")
            dispatcher, _ = create_dispatcher(question_images=cache)
            message = FakeMessage()
            message.answer_photo = AsyncMock(side_effect=RuntimeError("Telegram is down"))

            await handler(dispatcher.message, "start")(message)
            await handler(dispatcher.callback_query, "select_checkin")(SimpleNamespace(
                message=message, from_user=message.from_user,
                data="menu:checkin", answer=AsyncMock(),
            ))
            nonce = message.answer.await_args.kwargs["reply_markup"].inline_keyboard[0][0].callback_data.split(":")[1]
            await handler(dispatcher.callback_query, "callback")(SimpleNamespace(
                message=message, from_user=message.from_user,
                data=f"consent:{nonce}:yes", answer=AsyncMock(),
            ))

            self.assertTrue(message.answer.await_args.args[0].startswith("1/3"))
            self.assertIsNone(cache.get("energy"))

    async def test_question_photo_is_off_without_a_cache(self):
        dispatcher, _ = create_dispatcher()
        message = FakeMessage()

        await handler(dispatcher.message, "start")(message)
        await handler(dispatcher.callback_query, "select_checkin")(SimpleNamespace(
            message=message, from_user=message.from_user,
            data="menu:checkin", answer=AsyncMock(),
        ))
        nonce = message.answer.await_args.kwargs["reply_markup"].inline_keyboard[0][0].callback_data.split(":")[1]
        await handler(dispatcher.callback_query, "callback")(SimpleNamespace(
            message=message, from_user=message.from_user,
            data=f"consent:{nonce}:yes", answer=AsyncMock(),
        ))

        message.answer_photo.assert_not_awaited()
        self.assertTrue(message.answer.await_args.args[0].startswith("1/3"))


if __name__ == "__main__":
    unittest.main()
