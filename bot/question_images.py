"""Картинки к вопросам чек-ина и кеш их Telegram ``file_id``.

Первый показ загружает локальный PNG и запоминает ``file_id`` ответа.
Следующие показы отправляют только ``file_id`` — файл в Telegram не грузится.
Кеш переживает перезапуск: JSON рядом с журналом сообщений.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

from aiogram.types import FSInputFile

DEFAULT_IMAGE_DIR = Path(__file__).resolve().parent / "assets" / "questions"
FILE_VERSION = 1

logger = logging.getLogger(__name__)


class QuestionImageCache:
    """``file_id`` картинок по ключу вопроса, с сохранением на диск."""

    def __init__(self, path: Path | None = None) -> None:
        self.path = path
        self.file_ids: dict[str, str] = {}
        self._load()

    def get(self, key: str) -> str | None:
        """Сохранённый ``file_id`` или ``None``."""
        return self.file_ids.get(key)

    def remember(self, key: str, file_id: str) -> None:
        """Запоминает ``file_id`` и сразу пишет кеш на диск."""
        if not file_id or self.file_ids.get(key) == file_id:
            return
        self.file_ids[key] = file_id
        self._save()

    def forget(self, key: str) -> None:
        """Убирает устаревший ``file_id``, чтобы следующий показ загрузил файл."""
        if self.file_ids.pop(key, None) is not None:
            self._save()

    def _load(self) -> None:
        if self.path is None or not self.path.is_file():
            return
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            logger.warning("Не удалось прочитать кеш картинок вопросов: %s", error)
            return
        if not isinstance(data, dict) or data.get("version") != FILE_VERSION:
            return
        stored = data.get("fileIds")
        if not isinstance(stored, dict):
            return
        self.file_ids = {
            key: value
            for key, value in stored.items()
            if isinstance(key, str) and isinstance(value, str) and value
        }

    def _save(self) -> None:
        if self.path is None:
            return
        payload = {"version": FILE_VERSION, "fileIds": self.file_ids}
        temporary = self.path.with_name(self.path.name + ".tmp")
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            temporary.replace(self.path)
        except OSError as error:
            logger.warning("Не удалось сохранить кеш картинок вопросов: %s", error)


def _file_id_of(message: object) -> str | None:
    photos = getattr(message, "photo", None)
    if not photos:
        return None
    file_id = getattr(photos[-1], "file_id", None)
    return file_id if isinstance(file_id, str) and file_id else None


async def send_question_image(
    message: object,
    key: str,
    cache: QuestionImageCache | None,
    image_dir: Path = DEFAULT_IMAGE_DIR,
) -> str | None:
    """Отправляет картинку вопроса перед текстом.

    Картинка — украшение: любая ошибка Telegram не должна ломать чек-ин,
    поэтому здесь нет исключений, только ``None``.
    """
    if cache is None:
        return None
    path = image_dir / f"{key}.png"
    cached = cache.get(key)
    sources: list[object] = []
    if cached is not None:
        sources.append(cached)
    if path.is_file():
        sources.append(FSInputFile(path))
    for source in sources:
        try:
            sent = await message.answer_photo(source)
        except Exception as error:  # noqa: BLE001 — картинка не должна ронять сценарий
            logger.warning("Не удалось отправить картинку вопроса %s: %s", key, error)
            if source is cached:
                cache.forget(key)
            continue
        file_id = _file_id_of(sent)
        if file_id is not None:
            cache.remember(key, file_id)
        return file_id
    return None
