"""Команда /achievements: геймификация, условия разблокировки и форматирование."""
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from bot.__main__ import BOT_COMMANDS, create_dispatcher
from bot.http_transport import OrganizerRequiredError, TransportError
from bot import i18n


PUBLISHED_METRICS = {
    "status": "published",
    "metrics": {
        "outsideHoursPercent": 15,          # < 20 -> healthy_rhythm unlocked
        "participationEvenness": 88.5,      # > 80 -> balanced_team unlocked
        "positivityIndex": 25,             # > 20 -> gratitude_culture unlocked
        "recognitionPercent": 5,
        "responseMedianMinutes": 45,        # >= 30 -> fast_responders locked
        "unansweredQuestionsPercent": 8,    # >= 5 -> no_unanswered locked
        "intensityIndex": 1.2,              # < 2 -> zen_communication unlocked
    },
}


class FakeState:
    def __init__(self, data=None):
        self.data = dict(data or {})

    async def get_data(self):
        return dict(self.data)

    async def update_data(self, **kwargs):
        self.data.update(kwargs)


class FakeStatsTransport:
    def __init__(self, view=None, error=None):
        self.view = view if view is not None else PUBLISHED_METRICS
        self.error = error
        self.user_ids = []

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


def make_message(chat_type="private", user_id=12345):
    return SimpleNamespace(
        chat=SimpleNamespace(type=chat_type, id=user_id),
        from_user=SimpleNamespace(id=user_id, is_bot=False),
        answer=AsyncMock(),
    )


class AchievementsCommandTests(unittest.IsolatedAsyncioTestCase):
    def test_command_registered_in_bot_commands(self):
        command_names = [cmd.command for cmd in BOT_COMMANDS]
        self.assertIn("achievements", command_names)

    async def test_achievements_private_chat_displays_formatted_list(self):
        transport = FakeStatsTransport()
        dispatcher, _ = create_dispatcher(stats_transport=transport)
        msg = make_message()
        state = FakeState()

        await handler(dispatcher, "achievements_command")(msg, state)

        self.assertEqual(transport.user_ids, [12345])
        msg.answer.assert_awaited_once()
        text = msg.answer.await_args.args[0]

        self.assertIn("🏆 Достижения команды:", text)
        self.assertIn("🌙 Здоровый ритм — ✅ Открыто", text)
        self.assertIn("⚖️ Идеальный баланс — ✅ Открыто", text)
        self.assertIn("🙏 Культура благодарности — ✅ Открыто", text)
        self.assertIn("⚡ Быстрые ответы — 🔒 Заблокировано", text)
        self.assertIn("💬 Все услышаны — 🔒 Заблокировано", text)
        self.assertIn("🧘 Дзен-общение — ✅ Открыто", text)

    async def test_achievements_group_chat_rejected(self):
        transport = FakeStatsTransport()
        dispatcher, _ = create_dispatcher(stats_transport=transport)
        msg = make_message(chat_type="group")

        await handler(dispatcher, "achievements_command")(msg, FakeState())

        self.assertEqual(transport.user_ids, [])
        msg.answer.assert_awaited_once()
        self.assertIn("личном диалоге", msg.answer.await_args.args[0])

    async def test_achievements_without_connection(self):
        dispatcher, _ = create_dispatcher(stats_transport=None)
        msg = make_message()

        await handler(dispatcher, "achievements_command")(msg, FakeState())

        msg.answer.assert_awaited_once()
        self.assertIn("не подключён к серверу", msg.answer.await_args.args[0])

    async def test_achievements_organizer_only(self):
        transport = FakeStatsTransport(error=OrganizerRequiredError("Not an organizer"))
        dispatcher, _ = create_dispatcher(stats_transport=transport)
        msg = make_message()

        await handler(dispatcher, "achievements_command")(msg, FakeState())

        msg.answer.assert_awaited_once()
        self.assertIn("организатору", msg.answer.await_args.args[0])

    async def test_achievements_insufficient_data(self):
        transport = FakeStatsTransport(view={"status": "insufficient"})
        dispatcher, _ = create_dispatcher(stats_transport=transport)
        msg = make_message()

        await handler(dispatcher, "achievements_command")(msg, FakeState())

        msg.answer.assert_awaited_once()
        self.assertIn("недостаточно данных", msg.answer.await_args.args[0])

    async def test_achievements_network_error_offers_retry(self):
        transport = FakeStatsTransport(error=TransportError("Connection failed"))
        dispatcher, _ = create_dispatcher(stats_transport=transport)
        msg = make_message()

        await handler(dispatcher, "achievements_command")(msg, FakeState())

        msg.answer.assert_awaited_once()
        keyboard = msg.answer.await_args.kwargs.get("reply_markup")
        self.assertIsNotNone(keyboard)
        callbacks = [btn.callback_data for row in keyboard.inline_keyboard for btn in row]
        self.assertIn("retry:achievements", callbacks)

    async def test_retry_callback_delivers_achievements(self):
        transport = FakeStatsTransport()
        dispatcher, _ = create_dispatcher(stats_transport=transport)
        msg = make_message()
        event = SimpleNamespace(
            message=msg,
            from_user=msg.from_user,
            data="retry:achievements",
            answer=AsyncMock(),
        )

        await callback_handler(dispatcher, "retry_callback")(event, FakeState())

        event.answer.assert_awaited_once()
        msg.answer.assert_awaited_once()
        self.assertIn("🏆 Достижения команды:", msg.answer.await_args.args[0])

    async def test_achievements_english_locale(self):
        transport = FakeStatsTransport()
        dispatcher, _ = create_dispatcher(stats_transport=transport)
        msg = make_message()
        state = FakeState({"lang": "en"})

        await handler(dispatcher, "achievements_command")(msg, state)

        msg.answer.assert_awaited_once()
        text = msg.answer.await_args.args[0]
        self.assertIn("🏆 Team Achievements:", text)
        self.assertIn("🌙 Healthy Rhythm — ✅ Unlocked", text)
        self.assertIn("⚡ Fast Responders — 🔒 Locked", text)
