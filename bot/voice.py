"""Bounded local transcription for private consent flow and active intake chats."""
import asyncio
from contextlib import suppress
from dataclasses import dataclass
from io import BytesIO
import json
import os
from pathlib import Path
import secrets
import sys
import time

MAX_BYTES = 2 * 1024 * 1024
MAX_SECONDS = 60
MAX_TEXT = 2048
CONSENT_SECONDS = 300


class VoiceError(Exception):
    """A public, content-free error; provider errors never reach Telegram or logs."""


class LimitedAudio(BytesIO):
    def write(self, data):
        if self.tell() + len(data) > MAX_BYTES:
            raise VoiceError("Голосовое превышает 2 МиБ.")
        return super().write(data)


class LocalWhisperProvider:
    """One killable subprocess per recording; audio and transcript use pipes only."""
    def __init__(self, model_dir: str, timeout: float = 60):
        self.model_dir = Path(model_dir).resolve()
        if not self.model_dir.is_dir() or not (self.model_dir / "model.bin").is_file():
            raise ValueError("Set VIBEE_TRANSCRIPTION_MODEL_DIR to a local CTranslate2 Whisper model directory")
        self.timeout = timeout

    async def transcribe(self, audio: bytes) -> str:
        env = {key: value for key, value in os.environ.items()
               if key.upper() in {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "LANG", "LC_ALL"}}
        env.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", PYTHONIOENCODING="utf-8")
        process = await asyncio.create_subprocess_exec(
            sys.executable, str(Path(__file__).with_name("voice_worker.py")), str(self.model_dir),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL, env=env, limit=32768,
        )
        try:
            output, _ = await asyncio.wait_for(process.communicate(audio), timeout=self.timeout)
            if process.returncode or len(output) > 16384:
                raise VoiceError("Не удалось распознать голосовое. Проверьте формат и отправьте запись снова.")
            result = json.loads(output)
            text = result.get("text") if isinstance(result, dict) else None
            if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT:
                raise VoiceError("Речь не распознана или текст слишком длинный. Попробуйте более короткую запись.")
            return text.strip()
        except TimeoutError:
            raise VoiceError("Распознавание заняло слишком долго. Попробуйте более короткую запись.") from None
        except (ValueError, UnicodeError):
            raise VoiceError("Не удалось распознать голосовое.") from None
        finally:
            if process.returncode is None:
                with suppress(ProcessLookupError):
                    process.kill()
            await process.wait()


@dataclass
class VoiceConsent:
    nonce: str
    chat_id: int
    expires: float
    accepted: bool = False
    accepted_at: int | None = None


class VoiceTranscription:
    def __init__(self, provider, clock=time.monotonic, epoch_clock=time.time):
        self.provider = provider
        self.clock = clock
        self.epoch_clock = epoch_clock
        self.consents: dict[int, VoiceConsent] = {}
        self.jobs: dict[int, asyncio.Task] = {}

    def expire(self):
        for user, consent in list(self.consents.items()):
            if consent.expires <= self.clock():
                self.cancel(user)

    def begin(self, user_id: int, chat_id: int) -> str:
        self.expire()
        self.cancel(user_id)
        nonce = secrets.token_hex(8)
        self.consents[user_id] = VoiceConsent(nonce, chat_id, self.clock() + CONSENT_SECONDS)
        return nonce

    def accept(self, user_id: int, chat_id: int, nonce: str) -> bool:
        self.expire()
        grant = self.consents.get(user_id)
        if not grant or grant.chat_id != chat_id or not secrets.compare_digest(grant.nonce, nonce) or grant.accepted:
            return False
        grant.accepted = True
        grant.accepted_at = int(self.epoch_clock())
        return True

    def cancel(self, user_id: int):
        self.consents.pop(user_id, None)
        task = self.jobs.get(user_id)
        if task:
            task.cancel()

    async def close(self):
        tasks = list(self.jobs.values())
        for user in set(self.consents) | set(self.jobs):
            self.cancel(user)
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def transcribe_for_intake(self, *, user_id, sent_at, voice, download):
        """Transcribe audio only after the caller confirms an active group binding.

        Unlike the separate private /transcribe flow, authorization for this path
        comes from the active server-backed Telegram intake consent snapshot.
        """
        if (type(sent_at) is not int or not -30 <= self.epoch_clock() - sent_at <= 60):
            return None
        size, duration, mime = voice.file_size, voice.duration, voice.mime_type
        if (type(size) is not int or not 1 <= size <= MAX_BYTES
                or type(duration) is not int or not 1 <= duration <= MAX_SECONDS or mime != "audio/ogg"):
            raise VoiceError("Нужно голосовое Ogg/Opus до 60 секунд и 2 МиБ.")
        if self.jobs:
            raise VoiceError("Распознавание уже выполняется. Дождитесь результата и отправьте запись снова.")

        async def work():
            with LimitedAudio() as buffer:
                await asyncio.wait_for(download(buffer), timeout=15)
                audio = buffer.getvalue()
            if not audio or len(audio) != size or not audio.startswith(b"OggS"):
                raise VoiceError("Не удалось проверить формат или размер голосового.")
            text = await self.provider.transcribe(audio)
            if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT:
                raise VoiceError("Речь не распознана или текст слишком длинный.")
            if not -30 <= self.epoch_clock() - sent_at <= 60:
                return None
            return text.strip()

        task = asyncio.create_task(work())
        self.jobs[user_id] = task
        try:
            return await task
        except asyncio.CancelledError:
            if asyncio.current_task().cancelling():
                raise
            return None
        except VoiceError:
            raise
        except Exception:
            raise VoiceError("Не удалось обработать голосовое. Попробуйте отправить запись ещё раз.") from None
        finally:
            self.jobs.pop(user_id, None)

    async def recognize(self, *, user_id, chat_id, chat_type, sent_at, voice, download):
        self.expire()
        grant = self.consents.get(user_id)
        if chat_type != "private" or not grant or not grant.accepted or grant.chat_id != chat_id:
            return None
        if (type(sent_at) is not int or sent_at < grant.accepted_at
                or not -30 <= self.epoch_clock() - sent_at <= 60):
            return None
        if self.jobs:
            raise VoiceError("Распознавание уже выполняется. Дождитесь результата и отправьте запись снова.")
        size, duration, mime = voice.file_size, voice.duration, voice.mime_type
        if (type(size) is not int or not 1 <= size <= MAX_BYTES
                or type(duration) is not int or not 1 <= duration <= MAX_SECONDS or mime != "audio/ogg"):
            raise VoiceError("Нужно голосовое Ogg/Opus до 60 секунд и 2 МиБ.")

        async def work():
            with LimitedAudio() as buffer:
                await asyncio.wait_for(download(buffer), timeout=15)
                audio = buffer.getvalue()
            if not audio or len(audio) != size or not audio.startswith(b"OggS"):
                raise VoiceError("Не удалось проверить формат или размер голосового.")
            if self.consents.get(user_id) is not grant or grant.expires <= self.clock():
                return None
            text = await self.provider.transcribe(audio)
            if self.consents.get(user_id) is not grant or grant.expires <= self.clock():
                return None
            if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT:
                raise VoiceError("Речь не распознана или текст слишком длинный.")
            return text.strip()

        task = asyncio.create_task(work())
        self.jobs[user_id] = task
        try:
            return await task
        except asyncio.CancelledError:
            # /stop cancels this private job, not the dispatcher's polling task.
            if asyncio.current_task().cancelling():
                raise
            return None
        except VoiceError:
            raise
        except Exception:
            raise VoiceError("Не удалось обработать голосовое. Начните заново: /transcribe") from None
        finally:
            self.jobs.pop(user_id, None)
            if self.consents.get(user_id) is grant:
                self.consents.pop(user_id, None)


def install_voice_handlers(dispatcher, service: VoiceTranscription | None):
    from aiogram import F
    from aiogram.filters import Command
    from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, Message

    @dispatcher.message(Command("transcribe"))
    async def begin(message: Message):
        if message.chat.type != "private" or message.from_user is None or message.from_user.is_bot:
            return
        if service is None:
            await message.answer("Локальная расшифровка пока не настроена.")
            return
        nonce = service.begin(message.from_user.id, message.chat.id)
        await message.answer(
            "Расшифруем одно новое голосовое до 60 секунд и 2 МиБ. После согласия бот скачает его из Telegram "
            "и обработает локально на сервере без внешнего ИИ. Аудио и текст не записываются в файлы или БД; "
            "результат отправится только в этот личный чат и останется в Telegram. Не присылайте чужую речь "
            "без разрешения. Согласие действует 5 минут на одну запись. Отмена: /stop.",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=[[
                InlineKeyboardButton(text="Разрешаю одну расшифровку", callback_data=f"voice:{nonce}"),
            ]]),
        )

    @dispatcher.callback_query(F.data.startswith("voice:"))
    async def consent(event):
        if (service is None or not isinstance(event.message, Message) or event.message.chat.type != "private"
                or not service.accept(event.from_user.id, event.message.chat.id, event.data[6:])):
            await event.answer("Разрешение устарело. Начните заново: /transcribe", show_alert=True)
            return
        await event.answer()
        await event.message.answer("Отправьте одно новое голосовое. Отмена: /stop.")

    @dispatcher.message(F.voice, F.chat.type == "private")
    async def voice_message(message: Message):
        if service is None or message.chat.type != "private" or message.from_user is None or message.from_user.is_bot:
            return
        # Forwarded recordings are outside this explicit one-recording flow.
        if message.forward_origin is not None:
            await message.answer("В этом режиме принимаются только новые, непересланные голосовые.")
            return
        try:
            text = await service.recognize(
                user_id=message.from_user.id, chat_id=message.chat.id, chat_type=message.chat.type,
                sent_at=int(message.date.timestamp()),
                voice=message.voice, download=lambda destination: message.bot.download(
                    message.voice, destination=destination, timeout=15),
            )
            if text is not None:
                await message.answer("Расшифровка (может содержать ошибки):\n\n" + text, parse_mode=None)
        except VoiceError as error:
            await message.answer(str(error), parse_mode=None)
