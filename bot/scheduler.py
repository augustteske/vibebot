"""Weekly check-in reminder scheduler for Vibee Telegram Bot.

Tracks the last check-in timestamp per user in a JSON journal (VIBEBOT_DATA_DIR).
Once a week (by default Monday 10:00 UTC, or configurable), sends a friendly reminder
with an inline button to start the check-in if the user hasn't completed one in the past 7 days.
"""
from __future__ import annotations

import asyncio
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import datetime, timezone
import json
import logging
from pathlib import Path
import time
from typing import Callable

from aiogram import Bot
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from . import i18n

REMINDER_INTERVAL_SECONDS = 7 * 24 * 3600  # 7 days
DEFAULT_TARGET_WEEKDAY = 0  # Monday (0=Monday, 6=Sunday)
DEFAULT_TARGET_HOUR = 10    # 10:00 UTC
FILE_VERSION = 1


@dataclass
class CheckinHistoryJournal:
    """Stores the timestamp of the last check-in per user (user_id -> epoch_seconds)."""

    path: Path | None = None
    clock: Callable[[], float] = time.time
    users: dict[int, int] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self._load()

    def record_checkin(self, user_id: int, timestamp: int | None = None) -> None:
        ts = int(self.clock()) if timestamp is None else timestamp
        self.users[user_id] = ts
        self._save()

    def register_user(self, user_id: int) -> None:
        """Track user presence even before first check-in so they can receive reminders."""
        if user_id not in self.users:
            self.users[user_id] = 0
            self._save()

    def has_recent_checkin(self, user_id: int, window_seconds: int = REMINDER_INTERVAL_SECONDS) -> bool:
        last = self.users.get(user_id, 0)
        return (self.clock() - last) < window_seconds

    def users_needing_reminder(self, window_seconds: int = REMINDER_INTERVAL_SECONDS) -> list[int]:
        now = self.clock()
        return [uid for uid, last_ts in self.users.items() if (now - last_ts) >= window_seconds]

    def _load(self) -> None:
        if self.path is None or not self.path.is_file():
            return
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            logging.getLogger(__name__).warning("Check-in history journal is unreadable; starting empty")
            return
        if not isinstance(data, dict) or data.get("version") != FILE_VERSION:
            return
        users_raw = data.get("users")
        if not isinstance(users_raw, dict):
            return
        loaded: dict[int, int] = {}
        for raw_id, raw_ts in users_raw.items():
            try:
                loaded[int(raw_id)] = int(raw_ts)
            except (TypeError, ValueError):
                continue
        self.users = loaded

    def _save(self) -> None:
        if self.path is None:
            return
        payload = {
            "version": FILE_VERSION,
            "users": {str(k): v for k, v in self.users.items()},
        }
        temporary = self.path.with_name(self.path.name + ".tmp")
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            temporary.replace(self.path)
        except OSError:
            logging.getLogger(__name__).warning("Could not persist check-in history journal")


def checkin_reminder_keyboard(language: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(
            text=i18n.text(language, "reminder.button"),
            callback_data="menu:checkin",
        )
    ]])


class CheckinReminderScheduler:
    """Schedules and dispatches weekly reminders to users without check-ins in the last 7 days."""

    def __init__(
        self,
        bot: Bot,
        journal: CheckinHistoryJournal,
        language_getter: Callable[[int], str] | None = None,
        clock: Callable[[], float] = time.time,
    ):
        self.bot = bot
        self.journal = journal
        self.language_getter = language_getter or (lambda _: i18n.DEFAULT_LANGUAGE)
        self.clock = clock

    async def send_reminder_to_user(self, user_id: int) -> bool:
        language = self.language_getter(user_id)
        text = i18n.text(language, "reminder.text")
        keyboard = checkin_reminder_keyboard(language)
        try:
            await self.bot.send_message(chat_id=user_id, text=text, reply_markup=keyboard)
            return True
        except Exception as error:
            logging.getLogger(__name__).warning(
                "Could not send weekly check-in reminder to user %d: %s", user_id, error
            )
            return False

    async def run_reminders(self) -> int:
        """Checks all known users and sends reminders to those who haven't completed check-in in 7 days."""
        recipients = self.journal.users_needing_reminder()
        sent_count = 0
        for uid in recipients:
            if await self.send_reminder_to_user(uid):
                sent_count += 1
        return sent_count

    async def start_loop(self, poll_interval_seconds: float = 3600.0) -> None:
        """Loop that runs and checks for scheduled reminder execution."""
        last_sent_day = -1
        while True:
            await asyncio.sleep(poll_interval_seconds)
            now_dt = datetime.fromtimestamp(self.clock(), tz=timezone.utc)
            if now_dt.weekday() == DEFAULT_TARGET_WEEKDAY and now_dt.hour >= DEFAULT_TARGET_HOUR:
                current_day = now_dt.timetuple().tm_yday
                if current_day != last_sent_day:
                    await self.run_reminders()
                    last_sent_day = current_day
