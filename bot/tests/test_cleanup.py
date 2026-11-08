import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

from bot.__main__ import BOT_COMMANDS, CLEAN_DONE, CLEAN_EMPTY, CLEAN_PARTIAL, create_dispatcher
from bot.cleanup import MAX_MESSAGES_PER_CHAT, SentMessageJournal


def handler(observer, name):
    return next(item.callback for item in observer.handlers if item.callback.__name__ == name)


class FakeBot:
    def __init__(self, error=None, result=True):
        self.error = error
        self.result = result
        self.calls = []

    async def delete_messages(self, chat_id, message_ids):
        self.calls.append((chat_id, list(message_ids)))
        if self.error is not None:
            raise self.error
        return self.result


class FakeMessage:
    def __init__(self, user_id=41, chat_type="private", bot=None):
        self.chat = SimpleNamespace(id=user_id, type=chat_type)
        self.from_user = SimpleNamespace(id=user_id, is_bot=False)
        self.answer = AsyncMock()
        self.bot = bot or FakeBot()


class JournalTests(unittest.TestCase):
    def test_journal_prunes_after_48_hours_and_survives_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "clean.json"
            now = [1_000_000.0]
            journal = SentMessageJournal(path, clock=lambda: now[0])
            journal.record(7, 11)
            journal.record(7, 12)

            now[0] += 48 * 60 * 60 + 1
            journal.record(7, 13)

            self.assertEqual(journal.recent(7), [13])
            reloaded = SentMessageJournal(path, clock=lambda: now[0])
            self.assertEqual(reloaded.recent(7), [13])

    def test_corrupt_journal_is_ignored_instead_of_crashing(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "clean.json"
            path.write_text("{not json", encoding="utf-8")

            journal = SentMessageJournal(path)

            self.assertEqual(journal.recent(1), [])

    def test_journal_is_bounded_per_chat(self):
        journal = SentMessageJournal(clock=lambda: 1_000_000.0)
        for message_id in range(1, MAX_MESSAGES_PER_CHAT + 6):
            journal.record(9, message_id)

        recent = journal.recent(9)

        self.assertEqual(len(recent), MAX_MESSAGES_PER_CHAT)
        self.assertEqual(recent[0], 6)
        self.assertEqual(recent[-1], MAX_MESSAGES_PER_CHAT + 5)


class CleanCommandTests(unittest.IsolatedAsyncioTestCase):
    def test_clean_is_registered_in_the_telegram_menu(self):
        self.assertIn("clean", [command.command for command in BOT_COMMANDS])

    async def test_clean_deletes_tracked_messages_in_batches(self):
        journal = SentMessageJournal()
        for message_id in range(1, 151):
            journal.record(41, message_id)
        bot = FakeBot()
        dispatcher, _ = create_dispatcher(message_log=journal)
        message = FakeMessage(bot=bot)

        await handler(dispatcher.message, "clean_command")(message)

        self.assertEqual([len(batch) for _, batch in bot.calls], [100, 50])
        self.assertEqual(journal.recent(41), [])
        text = message.answer.await_args.args[0]
        self.assertIn("Чат очищен", text)
        self.assertIn("Если остались старые сообщения, удалите их вручную", text)
        self.assertIn("Telegram не позволяет ботам удалять их", text)
        self.assertIn("История диалога пропала", text)

    async def test_clean_without_tracked_messages_explains_nothing_to_delete(self):
        bot = FakeBot()
        dispatcher, _ = create_dispatcher(message_log=SentMessageJournal())
        message = FakeMessage(bot=bot)

        await handler(dispatcher.message, "clean_command")(message)

        self.assertEqual(bot.calls, [])
        self.assertEqual(message.answer.await_args.args[0], CLEAN_EMPTY)

    async def test_clean_keeps_ids_for_retry_when_telegram_rejects(self):
        journal = SentMessageJournal()
        journal.record(41, 11)
        journal.record(41, 12)
        dispatcher, _ = create_dispatcher(message_log=journal)
        message = FakeMessage(bot=FakeBot(error=RuntimeError("too old")))

        await handler(dispatcher.message, "clean_command")(message)

        self.assertEqual(journal.recent(41), [11, 12])
        self.assertEqual(message.answer.await_args.args[0], CLEAN_PARTIAL)

    async def test_clean_in_group_does_not_delete_anything(self):
        bot = FakeBot()
        dispatcher, _ = create_dispatcher(message_log=SentMessageJournal())
        message = FakeMessage(chat_type="group", bot=bot)

        await handler(dispatcher.message, "clean_command")(message)

        self.assertEqual(bot.calls, [])
        self.assertIn("только в личном диалоге", message.answer.await_args.args[0])

    async def test_clean_reports_success_text(self):
        journal = SentMessageJournal()
        journal.record(41, 11)
        dispatcher, _ = create_dispatcher(message_log=journal)
        message = FakeMessage(bot=FakeBot())

        await handler(dispatcher.message, "clean_command")(message)

        self.assertEqual(message.answer.await_args.args[0], CLEAN_DONE)


if __name__ == "__main__":
    unittest.main()
