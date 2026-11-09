"""Команда /stats: доступ, запрос сводки и оформление метрик."""
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx

from bot.__main__ import create_dispatcher
from bot.http_transport import HttpTransport, OrganizerRequiredError, TransportError


PUBLISHED = {
    "status": "published",
    "metrics": {
        "outsideHoursPercent": 25,
        "participationEvenness": 89.8,
        "recognitionPercent": 10,
    },
}


class FakeState:
    def __init__(self, data=None):
        self.data = dict(data or {})

    async def get_data(self):
        return dict(self.data)


class FakeStatsTransport:
    def __init__(self, view=None, error=None):
        self.view = view if view is not None else PUBLISHED
        self.error = error
        self.user_ids = []
        self.web_url = "https://vibee.example/app"

    async def get_summary(self, telegram_user_id=None, binding_id=None):
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


class StatsCommandTests(unittest.IsolatedAsyncioTestCase):
    async def test_stats_requests_summary_and_formats_metrics(self):
        transport = FakeStatsTransport()
        dispatcher, _ = create_dispatcher(stats_transport=transport)
        user_message = message()

        await handler(dispatcher, "stats_command")(user_message)

        self.assertEqual(transport.user_ids, [12345])
        text = user_message.answer.await_args.args[0]
        self.assertIn("📊 Статистика команды", text)
        self.assertIn("⏱ Вне работы: 25%", text)
        self.assertIn("🤝 Участие: 89.8%", text)
        self.assertIn("🙏 Благодарности: 10%", text)
        self.assertIn("███░░░░░░░", text)
        self.assertIn("█████████░", text)
        self.assertIn("█░░░░░░░░░", text)
        button = user_message.answer.await_args.kwargs["reply_markup"].inline_keyboard[0][0]
        self.assertEqual(button.text, "Открыть полный отчет")
        self.assertEqual(button.url, "https://vibee.example/app")

    async def test_stats_is_private_only(self):
        transport = FakeStatsTransport()
        dispatcher, _ = create_dispatcher(stats_transport=transport)
        user_message = message(chat_type="group")

        await handler(dispatcher, "stats_command")(user_message)

        self.assertEqual(transport.user_ids, [])
        self.assertIn("только в личном диалоге", user_message.answer.await_args.args[0])

    async def test_stats_explains_when_data_is_not_ready(self):
        for status in ("calibrating", "insufficient"):
            transport = FakeStatsTransport(view={"status": status})
            dispatcher, _ = create_dispatcher(stats_transport=transport)
            user_message = message()

            await handler(dispatcher, "stats_command")(user_message)

            self.assertIn(
                "Пока недостаточно данных для статистики. Пригласите коллег в чат!",
                user_message.answer.await_args.args[0],
            )

    async def test_stats_handles_other_statuses(self):
        transport = FakeStatsTransport(view={"status": "open"})
        dispatcher, _ = create_dispatcher(stats_transport=transport)
        user_message = message()

        await handler(dispatcher, "stats_command")(user_message)

        self.assertIn("сбор ещё не дал данных", user_message.answer.await_args.args[0])

    async def test_stats_reports_organizer_only(self):
        transport = FakeStatsTransport(error=OrganizerRequiredError("not an organizer"))
        dispatcher, _ = create_dispatcher(stats_transport=transport)
        user_message = message()

        await handler(dispatcher, "stats_command")(user_message)

        self.assertIn("только организатору", user_message.answer.await_args.args[0])

    async def test_stats_explains_missing_server(self):
        dispatcher, _ = create_dispatcher()
        user_message = message()

        await handler(dispatcher, "stats_command")(user_message)

        self.assertIn("не подключён к серверу", user_message.answer.await_args.args[0])

    async def test_stats_uses_selected_mode(self):
        transport = FakeStatsTransport()
        dispatcher, _ = create_dispatcher(stats_transport=transport)
        user_message = message()

        await handler(dispatcher, "stats_command")(user_message, FakeState({"style": "cute"}))

        text = user_message.answer.await_args.args[0]
        self.assertIn("📊 Статистика команды 💛", text)

    async def test_network_error_offers_retry(self):
        transport = FakeStatsTransport(error=TransportError("offline"))
        dispatcher, _ = create_dispatcher(stats_transport=transport)
        user_message = message()

        await handler(dispatcher, "stats_command")(user_message)

        self.assertIn("сетью", user_message.answer.await_args.args[0])
        retry = user_message.answer.await_args.kwargs["reply_markup"].inline_keyboard[0][0]
        self.assertEqual(retry.callback_data, "retry:stats")

        transport.error = None
        retry_event = callback("retry:stats")
        await callback_handler(dispatcher, "retry_callback")(retry_event)
        self.assertIn("📊 Статистика команды", retry_event.message.answer.await_args.args[0])


class SummaryTransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_transport_calls_bot_summary_with_telegram_user(self):
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
            view = await transport.get_summary(telegram_user_id=12345)
        finally:
            await client.aclose()

        self.assertEqual(view, PUBLISHED)
        self.assertEqual(
            seen["url"],
            "https://vibee.example/api/bot/v1/bindings/binding-1/summary?telegramUserId=12345",
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
                await transport.get_summary(telegram_user_id=12345)
        finally:
            await client.aclose()


if __name__ == "__main__":
    unittest.main()
