"""Python transport against the local synthetic Node API; never calls Telegram."""

import json
from pathlib import Path
import sqlite3
import subprocess
from tempfile import TemporaryDirectory
import unittest
from datetime import datetime, timezone
from uuid import uuid4

import httpx

from bot.http_transport import HttpTransport
from bot.intake import ConsentSnapshot, TelegramIntake
from bot.pause_state import PauseState


ROOT = Path(__file__).resolve().parents[2]


async def no_sleep(_delay):
    return None


def event(config, message_id="1"):
    return {"eventId": str(uuid4()), "expectedRevision": config["revision"],
        "chatId": config["chatId"], "messageId": message_id, "senderId": "300000001",
        "sentAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "text": "Synthetic transport test"}


class WrappedClient:
    def __init__(self, client):
        self.client = client
        self.posts = []
        self.offline = False
        self.lose_first_ack = False

    async def post(self, url, headers, json):
        self.posts.append(json.copy())
        if self.offline:
            raise httpx.ConnectError("offline")
        response = await self.client.post(url, headers=headers, json=json)
        if self.lose_first_ack:
            self.lose_first_ack = False
            raise httpx.ReadTimeout("response lost after server commit")
        return response

    async def get(self, url, headers):
        if self.offline:
            raise httpx.ConnectError("offline")
        return await self.client.get(url, headers=headers)


class LocalApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.process = subprocess.Popen(["node", "tests/telegram-transport-harness.mjs"],
            cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        line = self.process.stdout.readline()
        if not line:
            raise AssertionError("Local synthetic API did not start: " + self.process.stderr.read())
        self.config = json.loads(line)
        self.client = httpx.AsyncClient(timeout=5.0, trust_env=False)
        self.wrapped = WrappedClient(self.client)
        self.transport = HttpTransport(self.config["baseUrl"], self.config["bindingId"],
            self.config["credential"], self.wrapped, sleep=no_sleep)

    async def asyncTearDown(self):
        await self.client.aclose()
        self.process.terminate()
        self.process.wait(timeout=5)
        self.process.stdout.close()
        self.process.stderr.close()

    def count(self, table):
        with sqlite3.connect(self.config["dbPath"]) as db:
            return db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]

    async def test_lost_ack_retries_same_event_against_real_api_without_double_count(self):
        self.wrapped.lose_first_ack = True
        payload = event(self.config)
        result = await self.transport.send_text(payload)
        self.assertEqual(result["result"], "duplicate")
        self.assertEqual(len(self.wrapped.posts), 2)
        self.assertEqual(self.wrapped.posts[0], self.wrapped.posts[1])
        self.assertEqual(self.count("telegram_open_periods"), 1)
        with sqlite3.connect(self.config["dbPath"]) as db:
            self.assertEqual(db.execute("SELECT total FROM telegram_open_periods").fetchone()[0], 1)
        self.assertEqual(self.count("telegram_texts"), 1)

    async def test_offline_gap_blocks_new_text_until_pause_and_manual_resume(self):
        snapshot = ConsentSnapshot(chat_id=int(self.config["chatId"]), binding_id=self.config["bindingId"],
            revision=self.config["revision"], roster_version=1, active=True,
            roster=frozenset(), accepted_members=frozenset(), policy_version="synthetic-v1",
            consent_policy_version="synthetic-v1", roster_verified=True, company_accepted=True)
        with TemporaryDirectory() as directory:
            marker = Path(directory) / "gap.json"
            intake = TelegramIntake(snapshot, self.transport, PauseState(marker))
            update = lambda message_id: {"update_type": "message", "message": {
                "chat": {"id": snapshot.chat_id}, "from": {"id": 300000001, "is_bot": False},
                "message_id": message_id, "date": int(datetime.now(timezone.utc).timestamp()),
                "text": "Synthetic message"}}
            self.wrapped.offline = True
            self.assertEqual((await intake.process(update(1)))["result"], "paused")
            self.assertEqual(PauseState(marker).stage, "needed")
            self.assertFalse(await intake.reconcile_pause())
            before = len(self.wrapped.posts)
            self.assertIsNone(await intake.process(update(2)))
            self.assertEqual(len(self.wrapped.posts), before)
            self.wrapped.offline = False
            self.assertFalse(await intake.reconcile_pause())
            pause_revision = PauseState(marker).pause_revision
            self.assertEqual(PauseState(marker).stage, "awaiting_resume")
            with sqlite3.connect(self.config["dbPath"]) as db:
                phase = json.loads(db.execute("SELECT state FROM telegram_bindings").fetchone()[0])["phase"]
            self.assertEqual(phase, "paused")
            self.assertIsNone(await intake.process(update(3)))
            resume = await self.client.post(self.config["baseUrl"] + "/api/telegram/bindings/"
                + self.config["bindingId"] + "/control",
                headers={"Cookie": "vibebot_session=" + self.config["ownerToken"], "X-Vibee": "1"},
                json={"requestId": str(uuid4()), "expectedRevision": pause_revision, "action": "resume"})
            self.assertEqual(resume.status_code, 200, resume.text)
            self.assertTrue(await intake.reconcile_pause())
            self.assertFalse(marker.exists())
            self.assertEqual((await intake.process(update(4)))["result"], "accepted")
            with sqlite3.connect(self.config["dbPath"]) as db:
                self.assertEqual(db.execute("SELECT total FROM telegram_open_periods").fetchone()[0], 1)


if __name__ == "__main__":
    unittest.main()
