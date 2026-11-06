from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from bot.__main__ import create_dispatcher
from bot.intake import ConsentSnapshot, TelegramIntake
from bot.voice import LocalWhisperProvider, VoiceTranscription


SENT_AT = 1793433600
AUDIO = b"OggS synthetic voice fixture"


class FakeTransport:
    def __init__(self):
        self.events = []

    async def send_text(self, event):
        self.events.append(dict(event))
        return {"result": "accepted"}

    async def get_binding_status(self, binding_id):
        raise AssertionError("status should not be requested")

    async def get_summary(self, binding_id):
        raise AssertionError("summary should not be requested")


class FakeProvider:
    def __init__(self, text="Привет, команда"):
        self.text = text
        self.audio = []

    async def transcribe(self, audio):
        self.audio.append(audio)
        return self.text


def consent(active=True):
    return ConsentSnapshot(
        chat_id=-100123,
        binding_id="binding-test",
        revision=9,
        roster_version=4,
        active=active,
        roster=frozenset({11}),
        accepted_members=frozenset({11}),
        policy_version="policy-2",
        consent_policy_version="policy-2",
        roster_verified=True,
        company_accepted=True,
    )


class VoiceIntakeIntegrationTests(unittest.IsolatedAsyncioTestCase):
    def make_message(self, *, chat_id=-100123, chat_type="supergroup", message_id=55):
        message = SimpleNamespace(
            chat=SimpleNamespace(id=chat_id, type=chat_type),
            from_user=SimpleNamespace(id=11, is_bot=False),
            message_id=message_id,
            date=datetime.fromtimestamp(SENT_AT, timezone.utc),
            voice=SimpleNamespace(file_size=len(AUDIO), duration=4, mime_type="audio/ogg"),
            forward_origin=None,
            answer=AsyncMock(),
        )

        async def download(voice, destination, timeout):
            self.assertEqual(voice, message.voice)
            self.assertEqual(timeout, 15)
            destination.write(AUDIO)

        message.bot = SimpleNamespace(download=download)
        return message

    def voice_handler(self, dispatcher):
        return next(
            handler.callback
            for handler in dispatcher.message.handlers
            if handler.callback.__name__ == "voice_intake_message"
        )

    async def test_voice_file_is_downloaded_transcribed_and_sent_through_intake(self):
        transport = FakeTransport()
        intake = TelegramIntake(consent(), transport)
        provider = FakeProvider()
        worker = VoiceTranscription(provider, epoch_clock=lambda: SENT_AT + 1)
        dispatcher, _ = create_dispatcher(intake, worker)
        message = self.make_message()

        await self.voice_handler(dispatcher)(message)

        self.assertEqual(provider.audio, [AUDIO])
        self.assertEqual(len(transport.events), 1)
        self.assertEqual(transport.events[0]["text"], "Привет, команда")
        self.assertEqual(transport.events[0]["senderId"], "11")

    async def test_rate_limited_sender_is_rejected_before_audio_download(self):
        transport = FakeTransport()
        intake = TelegramIntake(consent(), transport)
        for message_id in range(1, 11):
            await intake.process({
                "update_type": "message",
                "message": {
                    "chat": {"id": -100123},
                    "from": {"id": 11, "is_bot": False},
                    "message_id": message_id,
                    "date": SENT_AT,
                    "text": f"message {message_id}",
                },
            })
        provider = FakeProvider()
        worker = VoiceTranscription(provider, epoch_clock=lambda: SENT_AT + 1)
        dispatcher, _ = create_dispatcher(intake, worker)
        message = self.make_message(message_id=11)
        message.bot.download = AsyncMock()

        await self.voice_handler(dispatcher)(message)

        message.bot.download.assert_not_awaited()
        self.assertEqual(provider.audio, [])
        self.assertEqual(len(transport.events), 10)

    async def test_inactive_or_unbound_chat_never_downloads_audio(self):
        transport = FakeTransport()
        intake = TelegramIntake(consent(active=False), transport)
        provider = FakeProvider()
        worker = VoiceTranscription(provider, epoch_clock=lambda: SENT_AT + 1)
        dispatcher, _ = create_dispatcher(intake, worker)
        message = self.make_message()
        message.bot.download = AsyncMock()

        await self.voice_handler(dispatcher)(message)

        message.bot.download.assert_not_awaited()
        self.assertEqual(provider.audio, [])
        self.assertEqual(transport.events, [])

    async def test_local_whisper_provider_pipes_audio_to_worker_and_reads_transcript(self):
        process = SimpleNamespace(
            returncode=0,
            communicate=AsyncMock(return_value=('{"text":"Привет, команда"}'.encode("utf-8"), None)),
            wait=AsyncMock(),
        )
        with TemporaryDirectory() as model_dir:
            Path(model_dir, "model.bin").touch()
            provider = LocalWhisperProvider(model_dir)
            with patch("bot.voice.asyncio.create_subprocess_exec", new=AsyncMock(return_value=process)) as spawn:
                transcript = await provider.transcribe(AUDIO)

        self.assertEqual(transcript, "Привет, команда")
        process.communicate.assert_awaited_once_with(AUDIO)
        self.assertTrue(str(spawn.call_args.args[1]).endswith("voice_worker.py"))
        self.assertNotIn("TELEGRAM_BOT_TOKEN", spawn.call_args.kwargs["env"])


if __name__ == "__main__":
    unittest.main()
