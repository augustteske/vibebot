import unittest
from bot.flow import CheckinFlow


class FlowTests(unittest.TestCase):
    def test_no_answers_before_consent(self):
        flow = CheckinFlow()
        nonce = flow.begin(1)
        with self.assertRaises(ValueError):
            flow.answer(1, nonce, 0, 3)

    def test_three_answers_and_immediate_deletion(self):
        flow = CheckinFlow()
        nonce = flow.begin(1)
        flow.consent(1, nonce, True)
        self.assertIsNone(flow.answer(1, nonce, 0, 4))
        self.assertIsNone(flow.answer(1, nonce, 1, 2))
        self.assertEqual(flow.answer(1, nonce, 2, 5), {"energy": 4, "clarity": 2, "support": 5})
        self.assertNotIn(1, flow.drafts)

    def test_refusal_and_revocation_delete_state(self):
        flow = CheckinFlow()
        nonce = flow.begin(1)
        self.assertFalse(flow.consent(1, nonce, False))
        self.assertNotIn(1, flow.drafts)
        flow.begin(2)
        flow.cancel(2)
        self.assertNotIn(2, flow.drafts)

    def test_expired_draft_is_removed(self):
        now = [0]
        flow = CheckinFlow(clock=lambda: now[0])
        nonce = flow.begin(1)
        now[0] = 301
        with self.assertRaises(ValueError):
            flow.consent(1, nonce, True)
        self.assertNotIn(1, flow.drafts)

    def test_old_buttons_and_other_users_do_not_change_answer(self):
        flow = CheckinFlow()
        old = flow.begin(1)
        nonce = flow.begin(1)
        with self.assertRaises(ValueError):
            flow.consent(1, old, True)
        with self.assertRaises(ValueError):
            flow.consent(2, nonce, True)
        flow.consent(1, nonce, True)
        flow.answer(1, nonce, 0, 4)
        with self.assertRaises(ValueError):
            flow.answer(1, nonce, 0, 1)
        self.assertEqual(flow.drafts[1].values["energy"], 4)

    def test_invalid_score_is_rejected(self):
        flow = CheckinFlow()
        nonce = flow.begin(1)
        flow.consent(1, nonce, True)
        for value in [True, 0, 6, 2.5, "3"]:
            with self.assertRaises(ValueError):
                flow.answer(1, nonce, 0, value)


if __name__ == "__main__":
    unittest.main()
