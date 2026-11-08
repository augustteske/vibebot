from __future__ import annotations

import unittest
from pathlib import Path
import tempfile
import time
from unittest.mock import AsyncMock, MagicMock

from bot.i18n import EN, RU
from bot.scheduler import CheckinHistoryJournal, CheckinReminderScheduler, checkin_reminder_keyboard


class SchedulerTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.journal_path = Path(self.temp_dir.name) / "checkin-history.json"

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_journal_records_and_prunes(self):
        current_time = 1000.0
        journal = CheckinHistoryJournal(self.journal_path, clock=lambda: current_time)
        journal.record_checkin(123)

        self.assertTrue(journal.has_recent_checkin(123, window_seconds=500))
        self.assertFalse(journal.has_recent_checkin(123, window_seconds=0))
        self.assertEqual(journal.users_needing_reminder(window_seconds=100), [])

        current_time += 7 * 24 * 3600 + 10
        self.assertEqual(journal.users_needing_reminder(), [123])

    def test_journal_persists_to_file_and_reloads(self):
        journal1 = CheckinHistoryJournal(self.journal_path, clock=lambda: 123456.0)
        journal1.record_checkin(42, 123450)
        journal1.register_user(99)

        journal2 = CheckinHistoryJournal(self.journal_path, clock=lambda: 123456.0)
        self.assertEqual(journal2.users.get(42), 123450)
        self.assertEqual(journal2.users.get(99), 0)

    async def test_scheduler_sends_reminders_only_to_users_needing_them(self):
        now = 1000000.0
        journal = CheckinHistoryJournal(self.journal_path, clock=lambda: now)
        # User 1 did check-in recently (2 days ago)
        journal.record_checkin(1, int(now - 2 * 24 * 3600))
        # User 2 did check-in 8 days ago
        journal.record_checkin(2, int(now - 8 * 24 * 3600))
        # User 3 registered but never completed a check-in
        journal.register_user(3)

        mock_bot = MagicMock()
        mock_bot.send_message = AsyncMock()

        scheduler = CheckinReminderScheduler(
            bot=mock_bot,
            journal=journal,
            language_getter=lambda uid: EN if uid == 3 else RU,
            clock=lambda: now,
        )

        sent_count = await scheduler.run_reminders()
        self.assertEqual(sent_count, 2)
        self.assertEqual(mock_bot.send_message.call_count, 2)

        # Check call arguments
        called_uids = [call.kwargs["chat_id"] for call in mock_bot.send_message.call_args_list]
        self.assertIn(2, called_uids)
        self.assertIn(3, called_uids)
        self.assertNotIn(1, called_uids)

        # User 3 got English reminder
        user3_call = next(call for call in mock_bot.send_message.call_args_list if call.kwargs["chat_id"] == 3)
        self.assertIn("haven't seen your answers", user3_call.kwargs["text"])
        self.assertEqual(user3_call.kwargs["reply_markup"].inline_keyboard[0][0].text, "Take check-in")

        # User 2 got Russian reminder
        user2_call = next(call for call in mock_bot.send_message.call_args_list if call.kwargs["chat_id"] == 2)
        self.assertIn("давно не видели твоих ответов", user2_call.kwargs["text"])
        self.assertEqual(user2_call.kwargs["reply_markup"].inline_keyboard[0][0].text, "Пройти чек-ин")
        self.assertEqual(user2_call.kwargs["reply_markup"].inline_keyboard[0][0].callback_data, "menu:checkin")
