import unittest

from bot.intake import ConsentSnapshot, TelegramIntake


class FakeTransport:
    def __init__(self):
        self.events = []

    def send_text(self, event):
        self.events.append(event.copy())


def full_consent(**changes):
    values = {
        "chat_id": -100123,
        "active": True,
        "roster": frozenset({11, 22}),
        "accepted_members": frozenset({11, 22}),
        "policy_version": "policy-2",
        "consent_policy_version": "policy-2",
        "roster_verified": True,
        "company_accepted": True,
    }
    values.update(changes)
    return ConsentSnapshot(**values)


def text_event(**changes):
    event = {
        "update_type": "message",
        "chat_id": -100123,
        "sender_id": 11,
        "message_id": 7,
        "text": "Синтетический текст",
    }
    event.update(changes)
    return event


class IntakeTests(unittest.TestCase):
    def test_full_consent_new_message_reaches_transport_once(self):
        transport = FakeTransport()
        intake = TelegramIntake(full_consent(), transport)
        event = text_event()

        self.assertTrue(intake.process(event))
        self.assertFalse(intake.process(event))
        self.assertEqual(transport.events, [event])

    def test_each_missing_consent_condition_blocks_without_forwarding(self):
        incomplete_snapshots = (
            full_consent(accepted_members=frozenset({11})),
            full_consent(company_accepted=False),
            full_consent(roster_verified=False),
            full_consent(consent_policy_version="old-policy"),
            full_consent(active=False),
        )
        for snapshot in incomplete_snapshots:
            with self.subTest(snapshot=snapshot):
                transport = FakeTransport()
                self.assertFalse(TelegramIntake(snapshot, transport).process(text_event()))
                self.assertEqual(transport.events, [])

    def test_pause_and_consent_withdrawal_stop_future_transmission(self):
        transport = FakeTransport()
        intake = TelegramIntake(full_consent(), transport)
        intake.update_consent(full_consent(active=False))
        self.assertFalse(intake.process(text_event()))

        intake.update_consent(full_consent(accepted_members=frozenset({11})))
        self.assertFalse(intake.process(text_event(message_id=8)))
        self.assertEqual(transport.events, [])

    def test_unknown_sender_and_other_chat_are_not_forwarded(self):
        transport = FakeTransport()
        intake = TelegramIntake(full_consent(), transport)

        self.assertFalse(intake.process(text_event(sender_id=999)))
        self.assertFalse(intake.process(text_event(chat_id=-100999)))
        self.assertEqual(transport.events, [])

    def test_non_message_and_non_text_updates_are_not_forwarded(self):
        transport = FakeTransport()
        intake = TelegramIntake(full_consent(), transport)

        self.assertFalse(intake.process(text_event(update_type="edited_message")))
        self.assertFalse(intake.process(text_event(update_type="callback_query")))
        self.assertFalse(intake.process(text_event(text=None)))
        self.assertFalse(intake.process(text_event(text="  \n")))
        self.assertEqual(transport.events, [])

    def test_malformed_identity_does_not_reach_transport(self):
        transport = FakeTransport()
        intake = TelegramIntake(full_consent(), transport)

        for field in ("chat_id", "sender_id", "message_id"):
            with self.subTest(field=field):
                self.assertFalse(intake.process(text_event(**{field: True})))
        self.assertEqual(transport.events, [])

    def test_rejected_messages_are_not_logged_or_sent(self):
        transport = FakeTransport()
        intake = TelegramIntake(full_consent(accepted_members=frozenset({11})), transport)
        secret_text = "Текст, который нельзя передавать или журналировать"

        self.assertFalse(intake.process(text_event(text=secret_text)))
        self.assertEqual(transport.events, [])


if __name__ == "__main__":
    unittest.main()
