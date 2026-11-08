"""Tracks bot messages in private chats so /clean stays inside Telegram's 48-hour window.

Telegram has no API to list a chat's history: a bot can only delete messages whose
IDs it remembers. The journal stores IDs and send times only — never text — and
keeps them for 48 hours so the journal can survive a bot restart.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
import time
from typing import Callable

DELETE_WINDOW_SECONDS = 48 * 60 * 60
DELETE_BATCH_SIZE = 100
MAX_MESSAGES_PER_CHAT = 500
FILE_VERSION = 1


@dataclass
class SentMessageJournal:
    """Recent bot message IDs per private chat, optionally persisted to a JSON file."""

    path: Path | None = None
    clock: Callable[[], float] = time.time
    chats: dict[int, list[list[int | float]]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self._load()

    def record(self, chat_id: int, message_id: int) -> None:
        self._prune()
        items = self.chats.setdefault(chat_id, [])
        items.append([message_id, int(self.clock())])
        del items[:-MAX_MESSAGES_PER_CHAT]
        self._save()

    def recent(self, chat_id: int) -> list[int]:
        self._prune()
        return [int(item[0]) for item in self.chats.get(chat_id, [])]

    def remove(self, chat_id: int, message_ids: list[int]) -> None:
        removed = set(message_ids)
        items = [item for item in self.chats.get(chat_id, []) if item[0] not in removed]
        if items:
            self.chats[chat_id] = items
        else:
            self.chats.pop(chat_id, None)
        self._save()

    def _prune(self) -> None:
        threshold = self.clock() - DELETE_WINDOW_SECONDS
        for chat_id in list(self.chats):
            items = [item for item in self.chats[chat_id] if item[1] >= threshold]
            if items:
                self.chats[chat_id] = items
            else:
                del self.chats[chat_id]

    def _load(self) -> None:
        if self.path is None or not self.path.is_file():
            return
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            logging.getLogger(__name__).warning("Cleanup journal is unreadable; starting with an empty one")
            return
        if not isinstance(data, dict) or data.get("version") != FILE_VERSION:
            return
        chats = data.get("chats")
        if not isinstance(chats, dict):
            return
        loaded: dict[int, list[list[int | float]]] = {}
        for raw_chat_id, raw_items in chats.items():
            try:
                chat_id = int(raw_chat_id)
            except (TypeError, ValueError):
                continue
            if not isinstance(raw_items, list):
                continue
            items = [
                [item[0], item[1]] for item in raw_items
                if isinstance(item, list) and len(item) == 2
                and type(item[0]) is int and type(item[1]) in (int, float)
            ]
            if items:
                loaded[chat_id] = items
        self.chats = loaded
        self._prune()

    def _save(self) -> None:
        if self.path is None:
            return
        payload = {
            "version": FILE_VERSION,
            "chats": {str(chat_id): items for chat_id, items in self.chats.items()},
        }
        temporary = self.path.with_name(self.path.name + ".tmp")
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            temporary.replace(self.path)
        except OSError:
            logging.getLogger(__name__).warning("Could not persist the cleanup journal")


async def delete_recent_messages(bot, journal: SentMessageJournal, chat_id: int) -> tuple[int, bool]:
    """Delete tracked bot messages in batches. Returns (deleted count, complete flag)."""
    message_ids = journal.recent(chat_id)
    deleted = 0
    complete = True
    for start in range(0, len(message_ids), DELETE_BATCH_SIZE):
        batch = message_ids[start:start + DELETE_BATCH_SIZE]
        try:
            result = await bot.delete_messages(chat_id=chat_id, message_ids=batch)
        except Exception as error:  # Telegram may reject stale or already deleted IDs.
            complete = False
            logging.getLogger(__name__).warning(
                "Telegram rejected a cleanup batch of %d messages (%s)", len(batch), type(error).__name__
            )
            continue
        if result is False:
            complete = False
            continue
        journal.remove(chat_id, batch)
        deleted += len(batch)
    return deleted, complete
