"""Команда /share: доступ организатора, запрос карточки и подпись к фото."""
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
from aiogram.enums import ChatMemberStatus
from aiogram.exceptions import TelegramBadRequest

from bot.__main__ import create_dispatcher
from bot.http_transport import HttpTransport, OrganizerRequiredError, ShareCard, TransportError
from bot.intake import BindingStatus

GROUP_CHAT_ID = -1001234567890


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
        edit_reply_markup=AsyncMock(),
    )


def callback(text, user_id=12345, chat_type="private", bot=None):
    return SimpleNamespace(
        message=message(chat_type=chat_type, user_id=user_id),
        from_user=SimpleNamespace(id=user_id, is_bot=False),
        data=text, answer=AsyncMock(), bot=bot,
    )


class FakeIntake:
    """Заглушка intake: только проверки чата и статуса привязки."""

    def __init__(self, chat_id=GROUP_CHAT_ID, phase="active", active=True):
        self.chat_id = chat_id
        self.phase = phase
        self.active = active
        self.status_calls = 0
        self.checked_chats = []

    async def get_binding_status(self):
        self.status_calls += 1
        return BindingStatus(
            phase=self.phase, revision=4, policyVersion="policy-1", rosterVersion=2,
        )

    def is_active_chat(self, chat_id):
        self.checked_chats.append(chat_id)
        return self.active and chat_id == self.chat_id


class FakeBot:
    """Заглушка бота: проверка прав в чате и отправка фото."""

    def __init__(self, member=None, member_error=None, send_error=None):
        self.id = 777
        self.member = member if member is not None else SimpleNamespace(status=ChatMemberStatus.ADMINISTRATOR)
        self.member_error = member_error
        self.send_error = send_error
        self.members = []
        self.photos = []

    async def get_chat_member(self, chat_id, user_id):
        self.members.append((chat_id, user_id))
        if self.member_error is not None:
            raise self.member_error
        return self.member

    async def send_photo(self, **kwargs):
        self.photos.append(kwargs)
        if self.send_error is not None:
            raise self.send_error
        return SimpleNamespace(message_id=1)


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


class ShareToGroupTests(unittest.IsolatedAsyncioTestCase):
    async def test_share_card_offers_group_button(self):
        dispatcher, _ = create_dispatcher(
            share_transport=FakeShareTransport(), group_chat_id=GROUP_CHAT_ID,
        )
        user_message = message()

        await handler(dispatcher, "share_command")(user_message)

        keyboard = user_message.answer_photo.await_args.kwargs["reply_markup"]
        button = keyboard.inline_keyboard[0][0]
        self.assertEqual(button.text, "Отправить в группу")
        self.assertEqual(button.callback_data, "share:group")

    async def test_share_card_has_no_group_button_without_chat(self):
        dispatcher, _ = create_dispatcher(share_transport=FakeShareTransport())
        user_message = message()

        await handler(dispatcher, "share_command")(user_message)

        self.assertIsNone(user_message.answer_photo.await_args.kwargs["reply_markup"])

    async def test_button_sends_card_to_team_chat(self):
        transport = FakeShareTransport()
        intake = FakeIntake()
        bot = FakeBot()
        dispatcher, _ = create_dispatcher(
            share_transport=transport, intake=intake, group_chat_id=GROUP_CHAT_ID,
        )
        event = callback("share:group", bot=bot)

        await callback_handler(dispatcher, "group_share_callback")(event, None)

        self.assertEqual(intake.status_calls, 1)
        self.assertEqual(intake.checked_chats, [GROUP_CHAT_ID])
        self.assertEqual(bot.members, [(GROUP_CHAT_ID, 777)])
        self.assertEqual(len(bot.photos), 1)
        sent = bot.photos[0]
        # В группу уходит только карточка с итогами и подпись — без данных участников.
        self.assertEqual(set(sent), {"chat_id", "photo", "caption"})
        self.assertEqual(sent["chat_id"], GROUP_CHAT_ID)
        self.assertEqual(sent["photo"].data, PNG)
        self.assertEqual(sent["photo"].filename, "vibee-team-pulse.png")
        self.assertEqual(
            sent["caption"],
            "📊 Пульс команды Ромашка за 5–12 ноября. "
            "Подробнее в кабинете: https://vibee.example/app",
        )
        self.assertIn("отправлена", event.answer.await_args.args[0])
        # Повторное нажатие невозможно: кнопка убрана с карточки организатора.
        event.message.edit_reply_markup.assert_awaited_once_with(reply_markup=None)

    async def test_group_caption_follows_chosen_language(self):
        transport = FakeShareTransport(
            card=ShareCard(image=PNG, team_name="Romashka", period_label="Nov 5–12"),
        )
        bot = FakeBot()
        dispatcher, _ = create_dispatcher(
            share_transport=transport, intake=FakeIntake(), group_chat_id=GROUP_CHAT_ID,
        )
        event = callback("share:group", bot=bot)

        await callback_handler(dispatcher, "group_share_callback")(event, FakeState({"lang": "en"}))

        self.assertEqual(
            bot.photos[0]["caption"],
            "📊 Team pulse of Romashka for Nov 5–12. "
            "Details in the dashboard: https://vibee.example/app",
        )

    async def test_group_send_is_blocked_when_chat_is_paused(self):
        bot = FakeBot()
        dispatcher, _ = create_dispatcher(
            share_transport=FakeShareTransport(), intake=FakeIntake(phase="paused"),
            group_chat_id=GROUP_CHAT_ID,
        )
        event = callback("share:group", bot=bot)

        await callback_handler(dispatcher, "group_share_callback")(event, None)

        self.assertEqual(bot.photos, [])
        self.assertTrue(event.answer.await_args.kwargs["show_alert"])
        self.assertIn("паузе", event.answer.await_args.args[0])

    async def test_group_send_is_blocked_without_consents(self):
        bot = FakeBot()
        dispatcher, _ = create_dispatcher(
            share_transport=FakeShareTransport(), intake=FakeIntake(active=False),
            group_chat_id=GROUP_CHAT_ID,
        )
        event = callback("share:group", bot=bot)

        await callback_handler(dispatcher, "group_share_callback")(event, None)

        self.assertEqual(bot.photos, [])
        self.assertIn("согласий", event.answer.await_args.args[0])

    async def test_group_send_is_blocked_without_rights(self):
        for member in (
            SimpleNamespace(status=ChatMemberStatus.RESTRICTED, can_send_messages=False),
            SimpleNamespace(status=ChatMemberStatus.LEFT),
            SimpleNamespace(status=ChatMemberStatus.KICKED),
        ):
            with self.subTest(status=member.status):
                bot = FakeBot(member=member)
                dispatcher, _ = create_dispatcher(
                    share_transport=FakeShareTransport(), intake=FakeIntake(),
                    group_chat_id=GROUP_CHAT_ID,
                )
                event = callback("share:group", bot=bot)

                await callback_handler(dispatcher, "group_share_callback")(event, None)

                self.assertEqual(bot.photos, [])
                self.assertIn("не может писать", event.answer.await_args.args[0])

    async def test_group_send_allows_unrestricted_bot_member(self):
        for member in (
            SimpleNamespace(status=ChatMemberStatus.MEMBER),
            SimpleNamespace(status=ChatMemberStatus.CREATOR),
            SimpleNamespace(status=ChatMemberStatus.RESTRICTED, can_send_messages=True),
        ):
            with self.subTest(status=member.status):
                bot = FakeBot(member=member)
                dispatcher, _ = create_dispatcher(
                    share_transport=FakeShareTransport(), intake=FakeIntake(),
                    group_chat_id=GROUP_CHAT_ID,
                )
                event = callback("share:group", bot=bot)

                await callback_handler(dispatcher, "group_share_callback")(event, None)

                self.assertEqual(len(bot.photos), 1)
                self.assertIn("отправлена", event.answer.await_args.args[0])

    async def test_group_send_reports_unreachable_chat(self):
        bot = FakeBot(member_error=TelegramBadRequest(method="getChatMember", message="chat not found"))
        dispatcher, _ = create_dispatcher(
            share_transport=FakeShareTransport(), intake=FakeIntake(),
            group_chat_id=GROUP_CHAT_ID,
        )
        event = callback("share:group", bot=bot)

        await callback_handler(dispatcher, "group_share_callback")(event, None)

        self.assertEqual(bot.photos, [])
        self.assertIn("не может писать", event.answer.await_args.args[0])

    async def test_group_send_reports_telegram_failure(self):
        bot = FakeBot(send_error=TelegramBadRequest(method="sendPhoto", message="not enough rights"))
        dispatcher, _ = create_dispatcher(
            share_transport=FakeShareTransport(), intake=FakeIntake(),
            group_chat_id=GROUP_CHAT_ID,
        )
        event = callback("share:group", bot=bot)

        await callback_handler(dispatcher, "group_share_callback")(event, None)

        self.assertEqual(len(bot.photos), 1)
        self.assertIn("Не получилось отправить", event.answer.await_args.args[0])

    async def test_group_send_without_configured_chat(self):
        bot = FakeBot()
        dispatcher, _ = create_dispatcher(
            share_transport=FakeShareTransport(), intake=FakeIntake(),
        )
        event = callback("share:group", bot=bot)

        await callback_handler(dispatcher, "group_share_callback")(event, None)

        self.assertEqual(bot.photos, [])
        self.assertIn("Чат команды не подключён", event.answer.await_args.args[0])

    async def test_group_send_requires_private_organizer_chat(self):
        bot = FakeBot()
        dispatcher, _ = create_dispatcher(
            share_transport=FakeShareTransport(), intake=FakeIntake(),
            group_chat_id=GROUP_CHAT_ID,
        )
        event = callback("share:group", chat_type="group", bot=bot)

        await callback_handler(dispatcher, "group_share_callback")(event, None)

        self.assertEqual(bot.photos, [])
        self.assertIn("личном диалоге", event.answer.await_args.args[0])

    async def test_group_send_is_organizer_only(self):
        transport = FakeShareTransport(summary_error=OrganizerRequiredError("not an organizer"))
        bot = FakeBot()
        dispatcher, _ = create_dispatcher(
            share_transport=transport, intake=FakeIntake(), group_chat_id=GROUP_CHAT_ID,
        )
        event = callback("share:group", bot=bot)

        await callback_handler(dispatcher, "group_share_callback")(event, None)

        self.assertEqual(bot.photos, [])
        self.assertEqual(transport.card_user_ids, [])
        self.assertIn("только организатор", event.answer.await_args.args[0])

    async def test_group_send_explains_missing_period(self):
        bot = FakeBot()
        dispatcher, _ = create_dispatcher(
            share_transport=FakeShareTransport(view={"status": "open"}), intake=FakeIntake(),
            group_chat_id=GROUP_CHAT_ID,
        )
        event = callback("share:group", bot=bot)

        await callback_handler(dispatcher, "group_share_callback")(event, None)

        self.assertEqual(bot.photos, [])
        self.assertIn("нет опубликованного периода", event.answer.await_args.args[0])


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
