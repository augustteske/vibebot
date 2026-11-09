"""Понятные ошибки сети: TransportError, лог и кнопка «Повторить»."""
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx

from bot.__main__ import create_dispatcher
from bot.http_transport import DeliveryUncertainError, HttpTransport, TransportError


FIXED_NOW = lambda: datetime(2026, 10, 31, 8, tzinfo=timezone.utc)


async def no_sleep(_delay):
    return None


class FakeHttpClient:
    """Подменяет httpx.AsyncClient: отдаёт ответы или бросает заданные ошибки."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    async def post(self, url, headers=None, json=None):
        self.calls.append((url, headers, json))
        result = self.responses.pop(0)
        if isinstance(result, BaseException):
            raise result
        return result


class FakeMessage:
    def __init__(self, user_id=41):
        self.chat = SimpleNamespace(id=user_id, type="private")
        self.from_user = SimpleNamespace(id=user_id, is_bot=False)
        self.text = ""
        self.answer = AsyncMock()
        self.answer_photo = AsyncMock()
        self.bot = SimpleNamespace(delete_messages=AsyncMock(return_value=True))


class FlakySubscribeTransport:
    def __init__(self):
        self.calls = []

    async def subscribe_notifications(self, user_id):
        self.calls.append(user_id)
        if len(self.calls) == 1:
            raise TransportError("offline", kind="timeout", request_id="req-subscribe")
        return {"subscribed": True, "notificationsEnabled": True}


def handler(observer, name):
    return next(item.callback for item in observer.handlers if item.callback.__name__ == name)


def event(message, data, **kwargs):
    return SimpleNamespace(
        message=message, from_user=message.from_user, data=data, answer=AsyncMock(), **kwargs,
    )


async def start_checkin(dispatcher, message):
    await handler(dispatcher.message, "start")(message)
    await handler(dispatcher.callback_query, "select_checkin")(event(message, "menu:checkin"))
    nonce = message.answer.await_args.kwargs["reply_markup"].inline_keyboard[0][0].callback_data.split(":")[1]
    await handler(dispatcher.callback_query, "callback")(event(message, f"consent:{nonce}:yes"))
    return nonce


async def answer_questions(dispatcher, message, count=3):
    for _ in range(count):
        button = message.answer.await_args.kwargs["reply_markup"].inline_keyboard[0][0]
        await handler(dispatcher.callback_query, "callback")(event(message, button.callback_data))


class TransportErrorTests(unittest.IsolatedAsyncioTestCase):
    async def test_timeout_keeps_request_id_and_does_not_log_message_text(self):
        client = FakeHttpClient([httpx.TimeoutException("boom") for _ in range(3)])
        transport = HttpTransport(
            "http://localhost:8787", "binding-1", "token",
            client=client, now=FIXED_NOW, sleep=no_sleep,
        )
        payload = {
            "eventId": "evt", "expectedRevision": 2, "chatId": "-1001", "messageId": "5",
            "senderId": "11", "sentAt": "2026-10-31T08:00:00.000Z",
            "text": "секретный текст сообщения",
        }

        with self.assertLogs("bot.http_transport", level="WARNING") as logs:
            with self.assertRaises(DeliveryUncertainError) as raised:
                await transport.send_text(payload)

        request_id = client.calls[0][1]["X-Request-Id"]
        self.assertEqual(len(client.calls), 3)
        self.assertEqual(raised.exception.kind, "timeout")
        self.assertEqual(raised.exception.request_id, request_id)
        output = "\n".join(logs.output)
        self.assertIn("kind=timeout", output)
        self.assertIn(request_id, output)
        self.assertNotIn("секретный текст", output)

    async def test_checkin_timeout_raises_transport_error_for_the_bot(self):
        client = FakeHttpClient([httpx.ReadTimeout("slow server")])
        transport = HttpTransport("http://localhost:8787", "binding-1", "token", client=client)

        with self.assertLogs("bot.http_transport", level="WARNING") as logs:
            with self.assertRaises(TransportError) as raised:
                await transport.submit_personal_checkin(
                    41, {"energy": 4, "clarity": 3, "support": 5}, "nonce",
                )

        request_id = client.calls[0][1]["X-Request-Id"]
        self.assertEqual(raised.exception.kind, "timeout")
        self.assertEqual(raised.exception.request_id, request_id)
        self.assertIn(request_id, "\n".join(logs.output))

    async def test_subscribe_timeout_raises_transport_error_with_request_id(self):
        client = FakeHttpClient([httpx.ConnectError("no route")])
        transport = HttpTransport("http://localhost:8787", "binding-1", "token", client=client)

        with self.assertRaises(TransportError) as raised:
            await transport.subscribe_notifications(41)

        self.assertEqual(raised.exception.kind, "network")
        self.assertEqual(raised.exception.request_id, client.calls[0][1]["X-Request-Id"])


class CheckinNetworkErrorTests(unittest.IsolatedAsyncioTestCase):
    async def test_timeout_shows_branded_error_and_retry_sends_the_same_checkin(self):
        client = FakeHttpClient([httpx.TimeoutException("boom")])
        transport = HttpTransport("http://localhost:8787", "binding-1", "token", client=client)
        dispatcher, _ = create_dispatcher(checkin_transport=transport)
        message = FakeMessage()

        nonce = await start_checkin(dispatcher, message)
        await answer_questions(dispatcher, message)

        error_text = message.answer.await_args.args[0]
        keyboard = message.answer.await_args.kwargs["reply_markup"]
        self.assertIn("🐝 Упс, кажется, у нас проблемы с сетью", error_text)
        self.assertIn("могли не сохраниться", error_text)
        self.assertEqual(keyboard.inline_keyboard[0][0].text, "Повторить")
        self.assertEqual(keyboard.inline_keyboard[0][0].callback_data, f"retry:checkin:{nonce}")

        client.responses.append(httpx.Response(200, json={"accepted": True}))
        await handler(dispatcher.callback_query, "retry_callback")(
            event(message, f"retry:checkin:{nonce}"),
        )

        self.assertIn("переданы на сервер", message.answer.await_args.args[0])
        self.assertEqual(len(client.calls), 2)
        self.assertEqual(client.calls[0][2]["nonce"], nonce)
        self.assertEqual(client.calls[1][2]["nonce"], nonce)

        expired = event(message, f"retry:checkin:{nonce}")
        await handler(dispatcher.callback_query, "retry_callback")(expired)
        self.assertIn("Пройдите чек-ин заново", expired.answer.await_args.args[0])
        self.assertTrue(expired.answer.await_args.kwargs["show_alert"])

    async def test_paused_checkin_has_no_retry_button(self):
        class RejectingTransport:
            async def submit_personal_checkin(self, user_id, scores, nonce):
                from bot.http_transport import PausedError

                raise PausedError("rejected")

        dispatcher, _ = create_dispatcher(checkin_transport=RejectingTransport())
        message = FakeMessage()

        await start_checkin(dispatcher, message)
        await answer_questions(dispatcher, message)

        self.assertIn("сервер отклонил", message.answer.await_args.args[0])
        self.assertNotIn("reply_markup", message.answer.await_args.kwargs)


class SubscribeNetworkErrorTests(unittest.IsolatedAsyncioTestCase):
    async def test_network_error_offers_retry_and_then_subscribes(self):
        transport = FlakySubscribeTransport()
        dispatcher, _ = create_dispatcher(notification_transport=transport)
        message = FakeMessage()

        await handler(dispatcher.message, "subscribe")(message)

        keyboard = message.answer.await_args.kwargs["reply_markup"]
        self.assertIn("🐝 Упс", message.answer.await_args.args[0])
        self.assertEqual(keyboard.inline_keyboard[0][0].callback_data, "retry:subscribe")
        self.assertEqual(keyboard.inline_keyboard[0][0].text, "Повторить")

        await handler(dispatcher.callback_query, "retry_callback")(
            event(message, "retry:subscribe"),
        )

        self.assertIn("Подписка включена", message.answer.await_args.args[0])
        self.assertEqual(transport.calls, [message.from_user.id, message.from_user.id])


if __name__ == "__main__":
    unittest.main()
