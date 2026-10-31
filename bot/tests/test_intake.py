import unittest
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

import httpx

from bot.http_transport import DeliveryUncertainError, HttpTransport, PausedError, StaleRevisionError, TransportError
from bot.intake import BindingStatus, CommunicationView, ConsentSnapshot, TelegramIntake
from bot.pause_state import PauseState


FIXED_NOW = lambda: datetime(2026, 10, 31, 8, tzinfo=timezone.utc)


async def no_sleep(_delay):
    return None


class FakeTransport:
    def __init__(self, result="accepted", status=None, responses=None):
        self.events = []
        self.result = result
        self.status = status or BindingStatus("active", 10, "policy-2", 4)
        self.responses = list(responses or [])
        self.status_requests = []
        self.summary_requests = []
        self.pause_requests = []

    async def send_text(self, event):
        self.events.append(event.copy())
        if self.responses:
            response = self.responses.pop(0)
            if isinstance(response, Exception):
                raise response
            return response
        return {"eventId": event["eventId"], "result": self.result, "revision": event["expectedRevision"] + 1}

    async def get_binding_status(self, binding_id):
        self.status_requests.append(binding_id)
        if isinstance(self.status, Exception):
            raise self.status
        return self.status

    async def get_summary(self, binding_id):
        self.summary_requests.append(binding_id)
        return CommunicationView("open")

    async def pause_transport_gap(self, expected_revision):
        self.pause_requests.append(expected_revision)
        self.status = BindingStatus("paused", expected_revision + 1, self.status.policyVersion, self.status.rosterVersion)
        return self.status


class FakeHttpClient:
    def __init__(self, response=None, error=None, sequence=None):
        self.response = response
        self.error = error
        self.sequence = list(sequence or [])
        self.calls = []

    async def post(self, url, headers, json):
        self.calls.append(("POST", url, headers, json))
        if self.sequence:
            item = self.sequence.pop(0)
            if isinstance(item, Exception):
                raise item
            return item
        if self.error:
            raise self.error
        return self.response

    async def get(self, url, headers):
        self.calls.append(("GET", url, headers, None))
        if self.error:
            raise self.error
        return self.response


def full_consent(**changes):
    values = {
        "chat_id": -100123,
        "binding_id": "binding-test",
        "revision": 9,
        "roster_version": 4,
        "active": True,
        "roster": frozenset(),
        "accepted_members": frozenset(),
        "policy_version": "policy-2",
        "consent_policy_version": "policy-2",
        "roster_verified": True,
        "company_accepted": True,
    }
    values.update(changes)
    return ConsentSnapshot(**values)


def telegram_update(**changes):
    message = {
        "chat": {"id": -100123},
        "from": {"id": 11, "is_bot": False},
        "message_id": 7,
        "date": 1793433600,
        "text": "Синтетический текст",
    }
    message.update(changes)
    return {"update_type": "message", "message": message}


class IntakeTests(unittest.IsolatedAsyncioTestCase):
    async def test_gap_marker_blocks_until_server_pause_and_distinct_manual_resume(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "pause.json"
            transport = FakeTransport(status=BindingStatus("active", 9, "policy-2", 4))
            intake = TelegramIntake(full_consent(), transport, PauseState(path))
            intake.stop_after_transport_gap()
            self.assertTrue(path.exists())
            self.assertNotIn("Синтетический", path.read_text(encoding="utf-8"))
            self.assertIsNone(await intake.process(telegram_update()))
            self.assertEqual(transport.events, [])
            transport.status = TransportError("offline")
            self.assertFalse(await intake.reconcile_pause())
            self.assertIsNone(await intake.process(telegram_update(message_id=8)))
            transport.status = BindingStatus("active", 9, "policy-2", 4)
            self.assertFalse(await intake.reconcile_pause())
            self.assertEqual(transport.pause_requests, [9])
            self.assertEqual(PauseState(path).stage, "awaiting_resume")
            self.assertIsNone(await intake.process(telegram_update(message_id=9)))
            self.assertFalse(await intake.reconcile_pause())  # Paused status is not a resume.
            transport.status = BindingStatus("active", 10, "policy-2", 4)
            self.assertFalse(await intake.reconcile_pause())  # Same revision cannot prove manual resume.
            transport.status = BindingStatus("active", 11, "policy-2", 4)
            self.assertTrue(await intake.reconcile_pause())
            self.assertFalse(path.exists())
            self.assertEqual((await intake.process(telegram_update(message_id=10)))["result"], "accepted")

    async def test_uncertain_delivery_marks_durable_gap_without_new_events(self):
        with TemporaryDirectory() as directory:
            transport = FakeTransport(status=TransportError("offline"), responses=[DeliveryUncertainError("timeout")])
            path = Path(directory) / "pause.json"
            intake = TelegramIntake(full_consent(), transport, PauseState(path))
            self.assertEqual((await intake.process(telegram_update(text="secret body")))["result"], "paused")
            self.assertEqual(PauseState(path).stage, "needed")
            self.assertNotIn("secret body", path.read_text(encoding="utf-8"))
            self.assertIsNone(await intake.process(telegram_update(message_id=8)))
            self.assertEqual(len(transport.events), 1)

    async def test_inactive_local_status_blocks_new_messages(self):
        transport = FakeTransport()
        intake = TelegramIntake(full_consent(active=False), transport)
        self.assertIsNone(await intake.process(telegram_update()))
        self.assertEqual(transport.events, [])

    async def test_other_chat_never_reaches_transport_and_gap_stops_delivery(self):
        transport = FakeTransport()
        intake = TelegramIntake(full_consent(), transport)
        other = telegram_update()
        other["message"]["chat"]["id"] = -100999
        self.assertIsNone(await intake.process(other))
        self.assertEqual(transport.events, [])
        intake.stop_after_transport_gap()
        self.assertIsNone(await intake.process(telegram_update()))
        self.assertEqual(transport.events, [])

    async def test_new_text_event_has_contract_fields_and_telegram_metadata(self):
        transport = FakeTransport()
        intake = TelegramIntake(full_consent(), transport)
        event = telegram_update(text='мой id 12345; chatId="-100999"')

        result = await intake.process(event)
        self.assertEqual(result["result"], "accepted")
        self.assertIsNone(await intake.process(event))
        payload = transport.events[0]
        self.assertEqual(
            set(payload),
            {"eventId", "expectedRevision", "chatId", "messageId", "senderId", "sentAt", "text"},
        )
        self.assertEqual(payload["chatId"], "-100123")
        self.assertEqual(payload["senderId"], "11")
        self.assertEqual(payload["sentAt"], "2026-10-31T08:00:00.000Z")
        self.assertIn("мой id 12345", payload["text"])

    async def test_non_text_edits_empty_text_and_bot_senders_are_dropped(self):
        transport = FakeTransport()
        intake = TelegramIntake(full_consent(), transport)
        self.assertIsNone(await intake.process({"update_type": "edited_message", "message": {}}))
        self.assertIsNone(await intake.process(telegram_update(text=" \n")))
        self.assertIsNone(await intake.process(telegram_update(**{"from": {"id": 11, "is_bot": True}})))
        self.assertEqual(transport.events, [])

    async def test_server_forbidden_pauses_and_logs_no_message_content(self):
        transport = FakeTransport(responses=[PausedError("forbidden")])
        intake = TelegramIntake(full_consent(), transport)
        secret_text = "private message content"

        with self.assertLogs("bot.intake", level="WARNING") as logs:
            result = await intake.process(telegram_update(text=secret_text))

        self.assertEqual(result["result"], "paused")
        self.assertEqual(len(transport.events), 1)
        self.assertFalse(any(secret_text in line for line in logs.output))
        self.assertIsNone(await intake.process(telegram_update(message_id=8, text=secret_text)))
        self.assertEqual(len(transport.events), 1)

    async def test_stale_revision_never_resends_old_text_with_new_revision(self):
        transport = FakeTransport(responses=[
            {"error": {"code": "STALE_REVISION"}},
            {"eventId": "retry-id", "result": "accepted", "revision": 11},
        ])
        intake = TelegramIntake(full_consent(), transport)

        result = await intake.process(telegram_update())

        self.assertEqual(result["error"]["code"], "STALE_REVISION")
        self.assertEqual(transport.status_requests, [])
        self.assertEqual(len(transport.events), 1)
        self.assertIsNone(await intake.process(telegram_update(message_id=8)))

    async def test_paused_binding_status_does_not_retry_stale_event(self):
        transport = FakeTransport(
            status=BindingStatus("paused", 10, "policy-2", 4),
            responses=[{"error": {"code": "STALE_REVISION"}}],
        )
        intake = TelegramIntake(full_consent(), transport)
        result = await intake.process(telegram_update())
        self.assertEqual(result["error"]["code"], "STALE_REVISION")
        self.assertEqual(len(transport.events), 1)
        self.assertEqual(transport.status_requests, [])

    async def test_status_and_summary_use_fake_transport(self):
        transport = FakeTransport()
        intake = TelegramIntake(full_consent(), transport)
        status = await intake.get_binding_status()
        summary = await intake.get_summary()
        self.assertEqual(status.phase, "active")
        self.assertEqual(summary.status, "open")
        self.assertEqual(transport.status_requests, ["binding-test"])
        self.assertEqual(transport.summary_requests, ["binding-test"])

    async def test_server_decisions_are_returned_to_caller(self):
        for decision in ("accepted", "duplicate", "paused"):
            with self.subTest(decision=decision):
                transport = FakeTransport(result=decision)
                result = await TelegramIntake(full_consent(), transport).process(telegram_update())
                self.assertEqual(result["result"], decision)

    async def test_paused_success_response_stops_following_messages(self):
        transport = FakeTransport(result="paused")
        intake = TelegramIntake(full_consent(), transport)
        self.assertEqual((await intake.process(telegram_update()))["result"], "paused")
        self.assertIsNone(await intake.process(telegram_update(message_id=8)))
        self.assertEqual(len(transport.events), 1)

    async def test_unknown_sender_is_sent_for_server_authoritative_check(self):
        transport = FakeTransport()
        result = await TelegramIntake(full_consent(), transport).process(
            telegram_update(**{"from": {"id": 98765, "is_bot": False}}),
        )
        self.assertEqual(result["result"], "accepted")
        self.assertEqual(transport.events[0]["senderId"], "98765")


class HttpTransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_retries_retryable_failures_with_identical_event_id_and_stops_at_three(self):
        responses = [httpx.ReadTimeout("lost"), httpx.Response(429, headers={"Retry-After": "1"}),
            httpx.Response(200, json={"eventId": "evt", "result": "duplicate", "revision": 9})]
        client = FakeHttpClient(sequence=responses)
        transport = HttpTransport("http://localhost:8787", "b", "token", client, now=FIXED_NOW, sleep=no_sleep)
        event = {"eventId": "evt", "expectedRevision": 9, "chatId": "-1001", "messageId": "1",
            "senderId": "11", "sentAt": "2026-10-31T08:00:00.000Z", "text": "private"}
        self.assertEqual((await transport.send_text(event))["result"], "duplicate")
        self.assertEqual(len(client.calls), 3)
        self.assertTrue(all(call[3] == event for call in client.calls))
        failed = FakeHttpClient(sequence=[httpx.Response(500), httpx.Response(502), httpx.Response(503)])
        with self.assertRaises(DeliveryUncertainError):
            await HttpTransport("http://localhost:8787", "b", "token", failed, now=FIXED_NOW, sleep=no_sleep).send_text(event)
        self.assertEqual(len(failed.calls), 3)

    async def test_get_binding_status_parses_the_server_snapshot(self):
        response = httpx.Response(200, json={
            "bindingId": "binding-1", "phase": "active", "revision": 9,
            "policyVersion": "policy-2", "rosterVersion": 4,
        })
        client = FakeHttpClient(response=response)
        transport = HttpTransport("http://localhost:8787", "binding-1", "token", client)
        status = await transport.get_binding_status()
        self.assertEqual(status, BindingStatus("active", 9, "policy-2", 4))

    async def test_post_uses_exact_contract_url_headers_and_fields(self):
        response = httpx.Response(200, json={"result": "accepted", "revision": 3})
        client = FakeHttpClient(response=response)
        transport = HttpTransport("http://localhost:8787/", "bind/id", "secret", client=client, now=FIXED_NOW)
        payload = {
            "eventId": "evt", "expectedRevision": 2, "chatId": "-1001", "messageId": "5",
            "senderId": "11", "sentAt": "2026-10-31T08:00:00.000Z", "text": "message",
            "unexpected": "not sent",
        }

        result = await transport.send_text(payload)

        method, url, headers, sent_json = client.calls[0]
        self.assertEqual(method, "POST")
        self.assertEqual(url, "http://localhost:8787/api/bot/v1/bindings/bind%2Fid/events")
        self.assertEqual(headers["Authorization"], "Bearer secret")
        self.assertEqual(headers["Content-Type"], "application/json")
        self.assertNotIn("unexpected", sent_json)
        self.assertEqual(result["result"], "accepted")

    async def test_http_error_mapping_and_network_errors(self):
        stale_client = FakeHttpClient(httpx.Response(409, json={"error": {"code": "STALE_REVISION"}}))
        with self.assertRaises(StaleRevisionError):
            await HttpTransport("http://localhost:8787", "b", "t", stale_client, now=FIXED_NOW).send_text({
                "eventId": "e", "expectedRevision": 1, "chatId": "1", "messageId": "1",
                "senderId": "1", "sentAt": "2026-10-31T08:00:00Z", "text": "x",
            })

        forbidden_client = FakeHttpClient(httpx.Response(403, json={"error": {"code": "FORBIDDEN"}}))
        with self.assertRaises(PausedError):
            await HttpTransport("http://localhost:8787", "b", "t", forbidden_client, now=FIXED_NOW).send_text({
                "eventId": "e", "expectedRevision": 1, "chatId": "1", "messageId": "1",
                "senderId": "1", "sentAt": "2026-10-31T08:00:00Z", "text": "x",
            })

        network_client = FakeHttpClient(error=httpx.ConnectError("offline"))
        with self.assertRaises(TransportError):
            await HttpTransport("http://localhost:8787", "b", "t", network_client, now=FIXED_NOW, sleep=no_sleep).send_text({
                "eventId": "e", "expectedRevision": 1, "chatId": "1", "messageId": "1",
                "senderId": "1", "sentAt": "2026-10-31T08:00:00Z", "text": "x",
            })

        error_client = FakeHttpClient(httpx.Response(500, json={"error": {"code": "UNAVAILABLE"}}))
        with self.assertRaises(TransportError):
            await HttpTransport("http://localhost:8787", "b", "t", error_client, now=FIXED_NOW, sleep=no_sleep).send_text({
                "eventId": "e", "expectedRevision": 1, "chatId": "1", "messageId": "1",
                "senderId": "1", "sentAt": "2026-10-31T08:00:00Z", "text": "x",
            })


if __name__ == "__main__":
    unittest.main()
