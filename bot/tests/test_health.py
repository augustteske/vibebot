"""Команда /health: доступ, запрос температуры и текст ответа."""
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx

from bot.__main__ import create_dispatcher
from bot.http_transport import HttpTransport, OrganizerRequiredError, TransportError


PUBLISHED = {"status": "published", "temperature": 62}


class FakeState:
    def __init__(self, data=None):
        self.data = dict(data or {})

    async def get_data(self):
        return dict(self.data)


class FakeHealthTransport:
    def __init__(self, view=None, error=None):
        self.view = view if view is not None else PUBLISHED
        self.error = error
        self.user_ids = []

    async def get_team_health(self, telegram_user_id):
        self.user_ids.append(telegram_user_id)
        if self.error is not None:
            raise self.error
        return self.view


def handler(dispatcher, name):
    return next(
        item.callback for item in dispatcher.message.handlers
        if item.callback.__name__ == name
    )


def callback_handler(dispatcher, name):
    return next(
        item.callback for item in dispatcher.callback_query.handlers
        if item.callback.__name__ == name
    )


def message(chat_type="private", user_id=12345):
    return SimpleNamespace(
        chat=SimpleNamespace(type=chat_type, id=user_id),
        from_user=SimpleNamespace(id=user_id, is_bot=False),
        answer=AsyncMock(),
    )


def callback(text, user_id=12345):
    return SimpleNamespace(
        message=message(user_id=user_id), from_user=SimpleNamespace(id=user_id, is_bot=False),
        data=text, answer=AsyncMock(),
    )


class HealthCommandTests(unittest.IsolatedAsyncioTestCase):
    async def test_health_requests_temperature_and_formats_message(self):
        transport = FakeHealthTransport()
        dispatcher, _ = create_dispatcher(health_transport=transport)
        user_message = message()

        await handler(dispatcher, "health_command")(user_message)

        self.assertEqual(transport.user_ids, [12345])
        text = user_message.answer.await_args.args[0]
        self.assertIn("🌡 Общая температура команды: 62%", text)
        self.assertIn("Рабочий ритм", text)

    async def test_health_names_each_band(self):
        for temperature, band in ((12, "Команда остывает"), (62, "Рабочий ритм"),
                                  (88, "Команда на подъёме")):
            transport = FakeHealthTransport(view={"status": "published", "temperature": temperature})
            dispatcher, _ = create_dispatcher(health_transport=transport)
            user_message = message()

            await handler(dispatcher, "health_command")(user_message)

            text = user_message.answer.await_args.args[0]
            self.assertIn(f"Общая температура команды: {temperature}%", text)
            self.assertIn(band, text)

    async def test_health_band_boundaries(self):
        for temperature, band in ((39, "Команда остывает"), (40, "Рабочий ритм"),
                                  (69, "Рабочий ритм"), (70, "Команда на подъёме")):
            transport = FakeHealthTransport(view={"status": "published", "temperature": temperature})
            dispatcher, _ = create_dispatcher(health_transport=transport)
            user_message = message()

            await handler(dispatcher, "health_command")(user_message)

            self.assertIn(band, user_message.answer.await_args.args[0])

    async def test_health_is_private_only(self):
        transport = FakeHealthTransport()
        dispatcher, _ = create_dispatcher(health_transport=transport)
        user_message = message(chat_type="group")

        await handler(dispatcher, "health_command")(user_message)

        self.assertEqual(transport.user_ids, [])
        self.assertIn("только в личном диалоге", user_message.answer.await_args.args[0])

    async def test_health_explains_when_data_is_not_ready(self):
        transport = FakeHealthTransport(view={"status": "insufficient"})
        dispatcher, _ = create_dispatcher(health_transport=transport)
        user_message = message()

        await handler(dispatcher, "health_command")(user_message)

        self.assertIn(
            "Пока недостаточно данных для температуры команды. Пригласите коллег в чат!",
            user_message.answer.await_args.args[0],
        )

    async def test_health_handles_unavailable_status(self):
        transport = FakeHealthTransport(view={"status": "unavailable"})
        dispatcher, _ = create_dispatcher(health_transport=transport)
        user_message = message()

        await handler(dispatcher, "health_command")(user_message)

        self.assertIn("сбор не идёт", user_message.answer.await_args.args[0])

    async def test_health_reports_organizer_only(self):
        transport = FakeHealthTransport(error=OrganizerRequiredError("not an organizer"))
        dispatcher, _ = create_dispatcher(health_transport=transport)
        user_message = message()

        await handler(dispatcher, "health_command")(user_message)

        self.assertIn("только организатор", user_message.answer.await_args.args[0])

    async def test_health_explains_missing_server(self):
        dispatcher, _ = create_dispatcher()
        user_message = message()

        await handler(dispatcher, "health_command")(user_message)

        self.assertIn("не подключён к серверу", user_message.answer.await_args.args[0])

    async def test_health_rejects_invalid_temperature(self):
        for value in ("62", None, True, 101, -1):
            transport = FakeHealthTransport(view={"status": "published", "temperature": value})
            dispatcher, _ = create_dispatcher(health_transport=transport)
            user_message = message()

            await handler(dispatcher, "health_command")(user_message)

            self.assertIn("Не удалось прочитать", user_message.answer.await_args.args[0])

    async def test_health_uses_selected_mode(self):
        transport = FakeHealthTransport()
        dispatcher, _ = create_dispatcher(health_transport=transport)
        user_message = message()

        await handler(dispatcher, "health_command")(user_message, FakeState({"style": "cute"}))

        text = user_message.answer.await_args.args[0]
        self.assertIn("🌡 Общая температура команды: 62% 💛", text)

    async def test_network_error_offers_retry(self):
        transport = FakeHealthTransport(error=TransportError("offline"))
        dispatcher, _ = create_dispatcher(health_transport=transport)
        user_message = message()

        await handler(dispatcher, "health_command")(user_message)

        self.assertIn("сетью", user_message.answer.await_args.args[0])
        retry = user_message.answer.await_args.kwargs["reply_markup"].inline_keyboard[0][0]
        self.assertEqual(retry.callback_data, "retry:health")

        transport.error = None
        retry_event = callback("retry:health")
        await callback_handler(dispatcher, "retry_callback")(retry_event)
        self.assertIn("🌡 Общая температура команды: 62%", retry_event.message.answer.await_args.args[0])


class HealthTransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_transport_calls_bot_health_with_telegram_user(self):
        seen = {}

        async def respond(request):
            seen["url"] = str(request.url)
            seen["authorization"] = request.headers["Authorization"]
            return httpx.Response(200, json=PUBLISHED)

        client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
        transport = HttpTransport(
            "https://vibee.example", "binding-1", "1" * 64, client=client,
        )
        try:
            view = await transport.get_team_health(12345)
        finally:
            await client.aclose()

        self.assertEqual(view, PUBLISHED)
        self.assertEqual(
            seen["url"],
            "https://vibee.example/api/bot/v1/bindings/binding-1/health?telegramUserId=12345",
        )
        self.assertEqual(seen["authorization"], "Bearer " + "1" * 64)

    async def test_transport_maps_organizer_error(self):
        async def respond(_request):
            return httpx.Response(403, json={"error": {"code": "ORGANIZER_REQUIRED"}})

        client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
        transport = HttpTransport(
            "https://vibee.example", "binding-1", "1" * 64, client=client,
        )
        try:
            with self.assertRaises(OrganizerRequiredError):
                await transport.get_team_health(12345)
        finally:
            await client.aclose()

    async def test_transport_rejects_broken_response(self):
        async def respond(_request):
            return httpx.Response(500, json={"error": {"code": "UNAVAILABLE"}})

        client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
        transport = HttpTransport(
            "https://vibee.example", "binding-1", "1" * 64, client=client,
        )
        try:
            with self.assertRaises(TransportError):
                await transport.get_team_health(12345)
        finally:
            await client.aclose()


if __name__ == "__main__":
    unittest.main()
