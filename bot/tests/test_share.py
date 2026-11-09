"""Команда /share: доступ организатора, запрос карточки и подпись к фото."""
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx

from bot.__main__ import create_dispatcher
from bot.http_transport import HttpTransport, OrganizerRequiredError, ShareCard, TransportError


PNG = b"\x89PNG\r\n\x1a\n" + b"synthetic-card"
PUBLISHED = {
    "status": "published",
    "metrics": {
        "outsideHoursPercent": 25,
        "participationEvenness": 89.8,
        "recognitionPercent": 20,
    },
}
CARD = ShareCard(image=PNG, team_name="Ромашка", period_label="5–12 ноября")


class FakeState:
    def __init__(self, data=None):
        self.data = dict(data or {})

    async def get_data(self):
        return dict(self.data)


class FakeShareTransport:
    def __init__(self, view=None, card=None, summary_error=None, card_error=None):
        self.view = view if view is not None else PUBLISHED
        self.card = card if card is not None else CARD
        self.summary_error = summary_error
        self.card_error = card_error
        self.user_ids = []
        self.card_user_ids = []
        self.web_url = "https://vibee.example/app"

    async def get_summary(self, telegram_user_id=None, binding_id=None):
        self.user_ids.append(telegram_user_id)
        if self.summary_error is not None:
            raise self.summary_error
        return self.view

    async def get_share_card(self, telegram_user_id):
        self.card_user_ids.append(telegram_user_id)
        if self.card_error is not None:
            raise self.card_error
        return self.card


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
        answer_photo=AsyncMock(),
    )


def callback(text, user_id=12345):
    return SimpleNamespace(
        message=message(user_id=user_id), from_user=SimpleNamespace(id=user_id, is_bot=False),
        data=text, answer=AsyncMock(),
    )


class ShareCommandTests(unittest.IsolatedAsyncioTestCase):
    async def test_share_sends_card_with_caption(self):
        transport = FakeShareTransport()
        dispatcher, _ = create_dispatcher(share_transport=transport)
        user_message = message()

        await handler(dispatcher, "share_command")(user_message)

        self.assertEqual(transport.user_ids, [12345])
        self.assertEqual(transport.card_user_ids, [12345])
        photo = user_message.answer_photo.await_args.args[0]
        self.assertEqual(photo.data, PNG)
        self.assertEqual(photo.filename, "vibee-team-pulse.png")
        self.assertEqual(
            user_message.answer_photo.await_args.kwargs["caption"],
            "📊 Пульс команды Ромашка за 5–12 ноября. "
            "Попробуйте Vibee для своей команды: https://vibee.example/app",
        )
        user_message.answer.assert_not_awaited()

    async def test_share_without_team_name_keeps_caption_readable(self):
        transport = FakeShareTransport(card=ShareCard(image=PNG, period_label="5–12 ноября"))
        dispatcher, _ = create_dispatcher(share_transport=transport)
        user_message = message()

        await handler(dispatcher, "share_command")(user_message)

        self.assertEqual(
            user_message.answer_photo.await_args.kwargs["caption"],
            "📊 Пульс команды за 5–12 ноября. "
            "Попробуйте Vibee для своей команды: https://vibee.example/app",
        )

    async def test_share_is_private_only(self):
        transport = FakeShareTransport()
        dispatcher, _ = create_dispatcher(share_transport=transport)
        user_message = message(chat_type="group")

        await handler(dispatcher, "share_command")(user_message)

        self.assertEqual(transport.user_ids, [])
        user_message.answer_photo.assert_not_awaited()
        self.assertIn("только в личном диалоге", user_message.answer.await_args.args[0])

    async def test_share_reports_organizer_only(self):
        transport = FakeShareTransport(summary_error=OrganizerRequiredError("not an organizer"))
        dispatcher, _ = create_dispatcher(share_transport=transport)
        user_message = message()

        await handler(dispatcher, "share_command")(user_message)

        user_message.answer_photo.assert_not_awaited()
        self.assertIn("только организатор", user_message.answer.await_args.args[0])

    async def test_share_explains_missing_period(self):
        for status in ("calibrating", "insufficient", "open"):
            transport = FakeShareTransport(view={"status": status})
            dispatcher, _ = create_dispatcher(share_transport=transport)
            user_message = message()

            await handler(dispatcher, "share_command")(user_message)

            self.assertEqual(transport.card_user_ids, [])
            self.assertIn("нет опубликованного периода", user_message.answer.await_args.args[0])

    async def test_share_explains_missing_server(self):
        dispatcher, _ = create_dispatcher()
        user_message = message()

        await handler(dispatcher, "share_command")(user_message)

        self.assertIn("не подключён к серверу", user_message.answer.await_args.args[0])

    async def test_network_error_offers_retry(self):
        transport = FakeShareTransport(card_error=TransportError("offline"))
        dispatcher, _ = create_dispatcher(share_transport=transport)
        user_message = message()

        await handler(dispatcher, "share_command")(user_message)

        self.assertIn("сетью", user_message.answer.await_args.args[0])
        retry = user_message.answer.await_args.kwargs["reply_markup"].inline_keyboard[0][0]
        self.assertEqual(retry.callback_data, "retry:share")

        transport.card_error = None
        retry_event = callback("retry:share")
        await callback_handler(dispatcher, "retry_callback")(retry_event)
        self.assertEqual(retry_event.message.answer_photo.await_args.args[0].data, PNG)

    async def test_share_uses_selected_language(self):
        transport = FakeShareTransport(
            card=ShareCard(image=PNG, team_name="Romashka", period_label="Nov 5–12"),
        )
        dispatcher, _ = create_dispatcher(share_transport=transport)
        user_message = message()

        await handler(dispatcher, "share_command")(user_message, FakeState({"lang": "en"}))

        self.assertEqual(
            user_message.answer_photo.await_args.kwargs["caption"],
            "📊 Team pulse of Romashka for Nov 5–12. "
            "Try Vibee for your team: https://vibee.example/app",
        )


class ShareCardTransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_transport_downloads_png_and_reads_headers(self):
        seen = {}

        async def respond(request):
            seen["url"] = str(request.url)
            seen["authorization"] = request.headers["Authorization"]
            return httpx.Response(200, content=PNG, headers={
                "Content-Type": "image/png",
                "X-Vibee-Team-Name": "%D0%A0%D0%BE%D0%BC%D0%B0%D1%88%D0%BA%D0%B0",
                "X-Vibee-Period-Label": "5%E2%80%9312%20%D0%BD%D0%BE%D1%8F%D0%B1%D1%80%D1%8F",
            })

        client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
        transport = HttpTransport(
            "https://vibee.example", "binding-1", "1" * 64, client=client,
        )
        try:
            card = await transport.get_share_card(12345)
        finally:
            await client.aclose()

        self.assertEqual(
            seen["url"],
            "https://vibee.example/api/bot/v1/bindings/binding-1/share-card?telegramUserId=12345",
        )
        self.assertEqual(seen["authorization"], "Bearer " + "1" * 64)
        self.assertEqual(card.image, PNG)
        self.assertEqual(card.team_name, "Ромашка")
        self.assertEqual(card.period_label, "5–12 ноября")

    async def test_transport_maps_organizer_error(self):
        async def respond(_request):
            return httpx.Response(403, json={"error": {"code": "ORGANIZER_REQUIRED"}})

        client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
        transport = HttpTransport(
            "https://vibee.example", "binding-1", "1" * 64, client=client,
        )
        try:
            with self.assertRaises(OrganizerRequiredError):
                await transport.get_share_card(12345)
        finally:
            await client.aclose()

    async def test_transport_rejects_unpublished_period(self):
        async def respond(_request):
            return httpx.Response(409, json={"error": {"code": "PERIOD_NOT_PUBLISHED"}})

        client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
        transport = HttpTransport(
            "https://vibee.example", "binding-1", "1" * 64, client=client,
        )
        try:
            with self.assertRaises(TransportError):
                await transport.get_share_card(12345)
        finally:
            await client.aclose()


if __name__ == "__main__":
    unittest.main()
