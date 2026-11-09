import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from bot.__main__ import create_dispatcher
from bot.http_transport import OrganizerRequiredError, PausedError, TransportError
from bot.voice import VoiceTranscription


class FakeMessage:
    def __init__(self, user_id=41, chat_type="private"):
        self.chat = SimpleNamespace(id=user_id, type=chat_type)
        self.from_user = SimpleNamespace(id=user_id, is_bot=False)
        self.answer = AsyncMock()


class RecordingCheckinTransport:
    def __init__(self, error=None):
        self.calls = []
        self.error = error

    async def submit_personal_checkin(self, user_id, scores, nonce):
        self.calls.append((user_id, scores, nonce))
        if self.error is not None:
            raise self.error
        return {"accepted": True}


def handler(observer, name):
    return next(item.callback for item in observer.handlers if item.callback.__name__ == name)


class ExperienceTests(unittest.IsolatedAsyncioTestCase):
    async def complete_checkin(self, dispatcher, message):
        await handler(dispatcher.message, "start")(message)
        select_event = SimpleNamespace(
            message=message, from_user=message.from_user, data="menu:checkin", answer=AsyncMock(),
        )
        await handler(dispatcher.callback_query, "select_checkin")(select_event)
        consent_text = message.answer.await_args.args[0]
        nonce = message.answer.await_args.kwargs["reply_markup"].inline_keyboard[0][0].callback_data.split(":")[1]
        await handler(dispatcher.callback_query, "callback")(SimpleNamespace(
            message=message, from_user=message.from_user,
            data=f"consent:{nonce}:yes", answer=AsyncMock(),
        ))
        for _ in range(3):
            button = message.answer.await_args.kwargs["reply_markup"].inline_keyboard[0][0]
            await handler(dispatcher.callback_query, "callback")(SimpleNamespace(
                message=message, from_user=message.from_user,
                data=button.callback_data, answer=AsyncMock(),
            ))
        return consent_text, message.answer.await_args.args[0]

    async def test_start_shows_scenarios_without_starting_questions(self):
        dispatcher, flow = create_dispatcher()
        message = FakeMessage()

        await handler(dispatcher.message, "start")(message)

        text = message.answer.await_args.args[0]
        keyboard = message.answer.await_args.kwargs["reply_markup"]
        callbacks = [button.callback_data for row in keyboard.inline_keyboard for button in row]
        self.assertIn("Привет! Я Vibee", text)
        self.assertIn("выберите сценарий", text.lower())
        self.assertNotIn("1/3", text)
        self.assertEqual(callbacks, ["menu:checkin", "menu:stats", "menu:leader_message", "menu:guide", "menu:settings"])
        self.assertEqual(flow.drafts, {})

    async def test_menu_checkin_requires_consent_before_first_question(self):
        dispatcher, flow = create_dispatcher()
        message = FakeMessage()
        await handler(dispatcher.message, "start")(message)

        event = SimpleNamespace(
            message=message,
            from_user=message.from_user,
            data="menu:checkin",
            answer=AsyncMock(),
        )
        await handler(dispatcher.callback_query, "select_checkin")(event)

        consent_text = message.answer.await_args.args[0]
        consent_keyboard = message.answer.await_args.kwargs["reply_markup"]
        consent_data = consent_keyboard.inline_keyboard[0][0].callback_data
        nonce = consent_data.split(":")[1]
        self.assertIn("согласие", consent_text.lower())
        self.assertIn("не отправляются в командный кабинет", consent_text)
        self.assertNotIn("аноним", consent_text.lower())
        self.assertNotIn("1/3", consent_text)
        self.assertEqual(flow.drafts[message.from_user.id].step, -1)
        with self.assertRaisesRegex(ValueError, "устарела"):
            flow.answer(message.from_user.id, nonce, 0, 4)

        consent_event = SimpleNamespace(
            message=message,
            from_user=message.from_user,
            data=f"consent:{nonce}:yes",
            answer=AsyncMock(),
        )
        await handler(dispatcher.callback_query, "callback")(consent_event)

        self.assertEqual(flow.drafts[message.from_user.id].step, 0)
        self.assertTrue(message.answer.await_args.args[0].startswith("1/3"))

        answer_count = message.answer.await_count
        await handler(dispatcher.callback_query, "select_checkin")(event)
        self.assertIn("Чек-ин уже открыт", event.answer.await_args.args[0])
        self.assertEqual(message.answer.await_count, answer_count)
        self.assertEqual(flow.drafts[message.from_user.id].nonce, nonce)

        for step in range(3):
            score_button = message.answer.await_args.kwargs["reply_markup"].inline_keyboard[0][0]
            self.assertEqual(score_button.callback_data, f"score:{nonce}:{step}:1")
            await handler(dispatcher.callback_query, "callback")(SimpleNamespace(
                message=message,
                from_user=message.from_user,
                data=score_button.callback_data,
                answer=AsyncMock(),
            ))

        self.assertNotIn(message.from_user.id, flow.drafts)
        completion_text = message.answer.await_args.args[0]
        self.assertIn("завершён", completion_text)
        self.assertIn("не отправлялись на сервер", completion_text)
        self.assertNotIn("reply_markup", message.answer.await_args.kwargs)

    async def test_decline_clears_draft_without_showing_a_question(self):
        dispatcher, flow = create_dispatcher()
        message = FakeMessage(user_id=42)
        await handler(dispatcher.message, "start")(message)
        select_event = SimpleNamespace(
            message=message, from_user=message.from_user, data="menu:checkin", answer=AsyncMock(),
        )
        await handler(dispatcher.callback_query, "select_checkin")(select_event)
        nonce = message.answer.await_args.kwargs["reply_markup"].inline_keyboard[0][0].callback_data.split(":")[1]

        decline_event = SimpleNamespace(
            message=message, from_user=message.from_user,
            data=f"consent:{nonce}:no", answer=AsyncMock(),
        )
        await handler(dispatcher.callback_query, "callback")(decline_event)

        self.assertNotIn(message.from_user.id, flow.drafts)
        self.assertIn("Отказ принят", message.answer.await_args.args[0])
        self.assertNotIn("1/3", message.answer.await_args.args[0])

    async def test_malformed_callback_returns_friendly_text_not_exception(self):
        dispatcher, _ = create_dispatcher()
        message = FakeMessage()
        event = SimpleNamespace(
            message=message, from_user=message.from_user,
            data="score:broken:not-a-number:3", answer=AsyncMock(),
        )

        await handler(dispatcher.callback_query, "callback")(event)

        public_text = event.answer.await_args.args[0]
        self.assertIn("Не удалось обработать выбор", public_text)
        self.assertNotIn("ValueError", public_text)
        self.assertNotIn("invalid literal", public_text)

    async def test_stop_cancels_both_private_drafts_and_voice_permission(self):
        service = VoiceTranscription(SimpleNamespace(transcribe=AsyncMock(return_value="synthetic")))
        dispatcher, flow = create_dispatcher(voice=service)
        message = FakeMessage()
        flow.begin(message.from_user.id)
        service.begin(message.from_user.id, message.chat.id)

        await handler(dispatcher.message, "stop")(message)

        self.assertNotIn(message.from_user.id, flow.drafts)
        self.assertNotIn(message.from_user.id, service.consents)
        stop_text = message.answer.await_args.args[0]
        self.assertIn("Текущий сценарий отменён", stop_text)
        self.assertNotIn("Уже переданные", stop_text)

    async def test_help_privacy_and_subscribe_follow_configuration_and_permissions(self):
        dispatcher, _ = create_dispatcher()
        names = [item.callback.__name__ for item in dispatcher.message.handlers]
        for command_name in ("start", "help_command", "privacy", "stop", "subscribe"):
            self.assertLess(names.index(command_name), names.index("intake_message"))
        self.assertLess(names.index("begin"), names.index("intake_message"))
        self.assertLess(names.index("voice_message"), names.index("voice_intake_message"))
        callback_names = [item.callback.__name__ for item in dispatcher.callback_query.handlers]
        self.assertIn("begin_from_menu", callback_names)
        self.assertIn("select_checkin", callback_names)
        self.assertIn("consent", callback_names)

        message = FakeMessage()
        await handler(dispatcher.message, "help_command")(message)
        help_text = message.answer.await_args.args[0]
        self.assertIn("/privacy", help_text)
        self.assertIn("локальная модель не настроена", help_text)
        self.assertIn("серверное подключение не настроено", help_text)
        self.assertNotIn("/subscribe —", help_text)

        await handler(dispatcher.message, "privacy")(message)
        privacy_text = message.answer.await_args.args[0]
        self.assertIn("до 5 минут", privacy_text)
        self.assertIn("локальной моделью", privacy_text)
        self.assertIn("не отправляются на сервер", privacy_text)
        self.assertIn("не удаляет историю Telegram", privacy_text)
        self.assertNotIn("аноним", privacy_text.lower())
        self.assertNotIn("без привязки", privacy_text.lower())

        await handler(dispatcher.message, "subscribe")(message)
        self.assertIn("не настроены", message.answer.await_args.args[0])

        class OrganizerOnlyTransport:
            async def subscribe_notifications(self, _user_id):
                raise OrganizerRequiredError("not an organizer")

        configured_dispatcher, _ = create_dispatcher(notification_transport=OrganizerOnlyTransport())
        await handler(configured_dispatcher.message, "help_command")(message)
        self.assertIn("/subscribe", message.answer.await_args.args[0])
        self.assertIn("организатора", message.answer.await_args.args[0])
        await handler(configured_dispatcher.message, "subscribe")(message)
        self.assertIn("только организатор", message.answer.await_args.args[0])

        class DeliveryDisabledTransport:
            async def subscribe_notifications(self, _user_id):
                return {"subscribed": True, "notificationsEnabled": False}

        disabled_dispatcher, _ = create_dispatcher(notification_transport=DeliveryDisabledTransport())
        await handler(disabled_dispatcher.message, "subscribe")(message)
        disabled_text = message.answer.await_args.args[0]
        self.assertIn("отправка уведомлений выключена", disabled_text)
        self.assertNotIn("будут приходить", disabled_text)

    async def test_privacy_with_transport_describes_server_storage_without_full_anonymity(self):
        dispatcher, _ = create_dispatcher(checkin_transport=RecordingCheckinTransport())
        message = FakeMessage()

        await handler(dispatcher.message, "privacy")(message)

        text = message.answer.await_args.args[0]
        self.assertIn("отправляются на сервер", text)
        self.assertIn("Telegram ID", text)
        self.assertIn("полной анонимности нет", text)
        self.assertIn("общую сводку", text)
        self.assertIn("не удаляет уже переданные данные", text)

    async def test_transport_checkin_explains_transfer_before_questions_and_confirms_success(self):
        transport = RecordingCheckinTransport()
        dispatcher, _ = create_dispatcher(checkin_transport=transport)
        message = FakeMessage(user_id=43)

        consent_text, result_text = await self.complete_checkin(dispatcher, message)

        self.assertIn("уходят на сервер", consent_text)
        self.assertIn("Telegram ID", consent_text)
        self.assertIn("общую сводку", consent_text)
        self.assertIn("/stop не удаляет уже переданные данные", consent_text)
        self.assertNotIn("аноним", consent_text.lower())
        self.assertIn("переданы на сервер", result_text)
        self.assertNotIn("аноним", result_text.lower())
        self.assertEqual([call[0] for call in transport.calls], [message.from_user.id])
        self.assertEqual(transport.calls[0][1], {"energy": 1, "clarity": 1, "support": 1})

    async def test_transport_checkin_rejection_does_not_claim_success(self):
        dispatcher, _ = create_dispatcher(checkin_transport=RecordingCheckinTransport(PausedError("rejected")))
        message = FakeMessage(user_id=44)

        _, result_text = await self.complete_checkin(dispatcher, message)

        self.assertIn("сервер отклонил", result_text)
        self.assertNotIn("переданы на сервер", result_text)

    async def test_transport_checkin_uncertain_delivery_does_not_claim_success_or_absence(self):
        dispatcher, _ = create_dispatcher(checkin_transport=RecordingCheckinTransport(TransportError("timeout")))
        message = FakeMessage(user_id=45)

        _, result_text = await self.complete_checkin(dispatcher, message)

        self.assertIn("подтвердить передачу на сервер не удалось", result_text)
        self.assertIn("могли не сохраниться", result_text)
        self.assertNotIn("переданы на сервер", result_text)

    async def test_stop_with_transport_does_not_claim_deleting_server_data(self):
        dispatcher, flow = create_dispatcher(checkin_transport=RecordingCheckinTransport())
        message = FakeMessage(user_id=46)
        flow.begin(message.from_user.id)

        await handler(dispatcher.message, "stop")(message)

        text = message.answer.await_args.args[0]
        self.assertIn("Уже переданные на сервер ответы не удаляются", text)

    async def test_group_start_without_intake_says_collection_is_not_configured(self):
        dispatcher, _ = create_dispatcher()
        message = FakeMessage(chat_type="group")

        await handler(dispatcher.message, "start")(message)

        text = message.answer.await_args.args[0]
        self.assertIn("не настроен", text)
        self.assertIn("не обрабатывает", text)
        self.assertIn("личном диалоге", text)

    async def test_group_start_with_intake_depends_on_server_status_and_consents(self):
        dispatcher, _ = create_dispatcher(intake=object())
        message = FakeMessage(chat_type="supergroup")

        await handler(dispatcher.message, "start")(message)

        text = message.answer.await_args.args[0]
        self.assertIn("согласиях компании и всех участников", text)
        self.assertIn("итоговый статус определяет сервер", text)
        self.assertIn("не означает, что сбор активен", text)
        self.assertNotIn("не собирает", text)
        self.assertNotIn("не настроен", text)
        self.assertIn("личном диалоге", text)

    async def test_voice_menu_is_conditional_and_requires_one_recording_consent(self):
        audio = b"OggS synthetic voice sample"

        class FakeProvider:
            def __init__(self):
                self.calls = []

            async def transcribe(self, data):
                self.calls.append(data)
                return "Синтетический текст расшифровки"

        provider = FakeProvider()
        service = VoiceTranscription(provider, epoch_clock=lambda: 1000)
        dispatcher, _ = create_dispatcher(voice=service)
        message = FakeMessage()
        message.date = SimpleNamespace(timestamp=lambda: 1000)
        message.forward_origin = None
        message.voice = SimpleNamespace(file_size=len(audio), duration=5, mime_type="audio/ogg")

        async def download(_voice, destination, timeout):
            self.assertEqual(timeout, 15)
            destination.write(audio)

        message.bot = SimpleNamespace(download=AsyncMock(side_effect=download))
        await handler(dispatcher.message, "start")(message)
        start_keyboard = message.answer.await_args.kwargs["reply_markup"]
        self.assertIn("menu:voice", [button.callback_data for row in start_keyboard.inline_keyboard for button in row])

        voice_menu_event = SimpleNamespace(
            message=message, from_user=message.from_user, data="menu:voice", answer=AsyncMock(),
        )
        await handler(dispatcher.callback_query, "begin_from_menu")(voice_menu_event)
        consent_text = message.answer.await_args.args[0]
        voice_nonce = message.answer.await_args.kwargs["reply_markup"].inline_keyboard[0][0].callback_data.split(":")[1]
        self.assertIn("одной новой голосовой", consent_text)
        self.assertFalse(service.consents[message.from_user.id].accepted)

        await handler(dispatcher.message, "voice_message")(message)
        message.bot.download.assert_not_awaited()
        self.assertEqual(provider.calls, [])

        voice_consent_event = SimpleNamespace(
            message=message, from_user=message.from_user,
            data=f"voice:{voice_nonce}", answer=AsyncMock(),
        )
        await handler(dispatcher.callback_query, "consent")(voice_consent_event)
        self.assertTrue(service.consents[message.from_user.id].accepted)
        await handler(dispatcher.message, "voice_message")(message)
        message.bot.download.assert_awaited_once()
        self.assertEqual(provider.calls, [audio])
        self.assertIn("Синтетический текст расшифровки", message.answer.await_args.args[0])
        self.assertNotIn(message.from_user.id, service.consents)


if __name__ == "__main__":
    unittest.main()
