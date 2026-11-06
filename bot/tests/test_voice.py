import asyncio
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from bot.__main__ import create_dispatcher
from bot.voice import LocalWhisperProvider, MAX_BYTES, VoiceError, VoiceTranscription


class VoiceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.now = [1000]
        self.provider = SimpleNamespace(transcribe=AsyncMock(return_value="Привет, команда"))
        self.service = VoiceTranscription(self.provider, clock=lambda: self.now[0], epoch_clock=lambda: self.now[0])
        self.audio = b"OggS synthetic fixture"
        self.download = AsyncMock(side_effect=lambda out: out.write(self.audio))

    def authorize(self, user=1, chat=1):
        nonce = self.service.begin(user, chat)
        self.assertTrue(self.service.accept(user, chat, nonce))
        return nonce

    async def recognize(self, **changes):
        args = dict(user_id=1, chat_id=1, chat_type="private", sent_at=int(self.now[0]),
                    voice=SimpleNamespace(file_size=len(self.audio), duration=4, mime_type="audio/ogg"),
                    download=self.download)
        args.update(changes)
        return await self.service.recognize(**args)

    async def test_download_requires_separate_current_consent_in_same_private_chat(self):
        self.assertIsNone(await self.recognize())
        nonce = self.service.begin(1, 1)
        self.assertIsNone(await self.recognize())
        self.assertFalse(self.service.accept(2, 1, nonce))
        self.assertFalse(self.service.accept(1, 2, nonce))
        self.assertTrue(self.service.accept(1, 1, nonce))
        self.assertIsNone(await self.recognize(chat_type="group"))
        self.assertIsNone(await self.recognize(chat_id=2))
        self.assertIsNone(await self.recognize(user_id=2))
        self.assertIsNone(await self.recognize(sent_at=999))
        self.assertFalse(self.service.accept(1, 1, nonce))
        self.download.assert_not_awaited()
        self.provider.transcribe.assert_not_awaited()

    async def test_one_recording_then_delete_consent_and_ignore_replay(self):
        self.authorize()
        self.assertEqual(await self.recognize(), "Привет, команда")
        self.assertEqual(self.service.consents, {})
        self.assertEqual(self.service.jobs, {})
        self.assertIsNone(await self.recognize())
        self.download.assert_awaited_once()

    async def test_expired_refused_and_old_permissions_never_download(self):
        old = self.authorize()
        nonce = self.service.begin(1, 1)
        self.assertFalse(self.service.accept(1, 1, old))
        self.assertTrue(self.service.accept(1, 1, nonce))
        self.now[0] += 301
        self.assertIsNone(await self.recognize())
        self.authorize()
        self.service.cancel(1)
        self.assertIsNone(await self.recognize())
        self.download.assert_not_awaited()

    async def test_limits_before_download_and_real_download_limit(self):
        self.authorize()
        for size, duration, mime in [(MAX_BYTES + 1, 4, "audio/ogg"), (1, 61, "audio/ogg"),
                                     (1, 4, "audio/wav"), (None, 4, "audio/ogg")]:
            with self.assertRaises(VoiceError):
                await self.recognize(voice=SimpleNamespace(file_size=size, duration=duration, mime_type=mime))
        self.download.assert_not_awaited()
        with self.assertRaises(VoiceError):
            await self.recognize(download=AsyncMock(side_effect=lambda out: out.write(b'x' * (MAX_BYTES + 1))))
        self.provider.transcribe.assert_not_awaited()
        self.assertEqual(self.service.consents, {})

    async def test_bad_container_and_size_mismatch_are_not_sent_to_provider(self):
        for data in [b"not an ogg", b"OggS short"]:
            self.authorize()
            with self.assertRaises(VoiceError):
                await self.recognize(download=AsyncMock(side_effect=lambda out: out.write(data)))
        self.provider.transcribe.assert_not_awaited()

    async def test_stop_during_provider_cancels_job_and_never_returns_transcript(self):
        started, stopped = asyncio.Event(), asyncio.Event()
        async def slow(_):
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                stopped.set()
        self.provider.transcribe.side_effect = slow
        self.authorize()
        task = asyncio.create_task(self.recognize())
        await started.wait()
        self.service.cancel(1)
        self.assertIsNone(await task)
        self.assertTrue(stopped.is_set())
        self.assertFalse(self.service.jobs)

    async def test_expiration_while_waiting_and_busy_user_do_not_release_old_answer(self):
        started, release = asyncio.Event(), asyncio.Event()
        async def slow(_):
            started.set()
            await release.wait()
            return "late transcript"
        self.provider.transcribe.side_effect = slow
        self.authorize()
        task = asyncio.create_task(self.recognize())
        await started.wait()
        self.authorize(2, 2)
        with self.assertRaises(VoiceError):
            await self.recognize(user_id=2, chat_id=2)
        self.now[0] += 301
        release.set()
        self.assertIsNone(await task)

    async def test_provider_error_or_invalid_output_does_not_expose_content(self):
        for result in ["", " " * 5, "x" * 2049, None, RuntimeError("secret audio contents")]:
            self.authorize()
            self.provider.transcribe.side_effect = result if isinstance(result, Exception) else None
            self.provider.transcribe.return_value = result
            with self.assertRaises(VoiceError) as error:
                await self.recognize()
            self.assertNotIn("secret", str(error.exception))
            self.assertFalse(self.service.consents)

    async def test_handlers_ignore_groups_forwarded_voice_and_escape_transcripts(self):
        dispatcher, _ = create_dispatcher(voice=self.service)
        handlers = {h.callback.__name__: h.callback for h in dispatcher.message.handlers}
        message = SimpleNamespace(chat=SimpleNamespace(type="group", id=1),
            from_user=SimpleNamespace(id=1, is_bot=False), answer=AsyncMock(), forward_origin=None)
        await handlers['begin'](message)
        await handlers['voice_message'](message)
        self.assertFalse(self.service.consents)
        self.authorize()
        message.chat.type = 'private'
        message.forward_origin = object()
        await handlers['voice_message'](message)
        self.download.assert_not_awaited()
        message.forward_origin = None
        message.voice = SimpleNamespace(file_size=len(self.audio), duration=4, mime_type='audio/ogg')
        message.date = SimpleNamespace(timestamp=lambda: 1000)
        async def download(_, destination, timeout):
            destination.write(self.audio)
        message.bot = SimpleNamespace(download=download)
        self.provider.transcribe.return_value = '<b>not markup</b>'
        await handlers['voice_message'](message)
        self.assertEqual(message.answer.call_args.kwargs, {'parse_mode': None})

    async def test_worker_is_killed_on_timeout_and_has_no_bot_secrets(self):
        with TemporaryDirectory() as directory:
            (Path(directory) / 'model.bin').touch()
            provider = LocalWhisperProvider(directory, timeout=0.01)
            async def hang(_):
                await asyncio.Event().wait()
            process = SimpleNamespace(communicate=AsyncMock(side_effect=hang), returncode=None,
                kill=lambda: setattr(process, 'returncode', -1), wait=AsyncMock())
            with patch('bot.voice.asyncio.create_subprocess_exec', AsyncMock(return_value=process)) as spawn:
                with patch.dict('os.environ', {'TELEGRAM_BOT_TOKEN': 'must-not-inherit'}):
                    with self.assertRaises(VoiceError):
                        await provider.transcribe(self.audio)
                self.assertNotIn('TELEGRAM_BOT_TOKEN', spawn.call_args.kwargs['env'])
                self.assertEqual(process.returncode, -1)
                process.wait.assert_awaited_once()


if __name__ == '__main__':
    unittest.main()
