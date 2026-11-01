# Vibee Bot (Ilian zone — feat/ilian-bot)

Python 3.12 + aiogram 3.x. Зона ответственности: Telegram, согласия, транспорт, статус/сводки.

## Что сейчас есть

- `consent.py` — стейт-машина согласий и паузы чата
- `transport.py` — FakeTransport (локальный мок) + заготовка под HTTP
- `handlers/group.py` — гейт: без ACTIVE тексты не уходят
- `tests/test_consent.py` — покрывает главный инвариант

### Главный инвариант
Без полного согласия (и при неизвестном участнике / отзыве) сообщения **не** попадают в transport.

## Быстрая проверка (без токена и сети)

```bash
# из корня репозитория
python -m venv bot/.venv
source bot/.venv/bin/activate   # Windows: bot\.venv\Scripts\activate
pip install -r bot/requirements.txt   # пока можно пустой / минимальный

python -m bot --check
# или
python -m unittest discover -s bot/tests -v
```

## Что ещё предстоит (P0/P1)

1. Подключение тестового чата + объяснение privacy mode / прав
2. Реальный HTTP-транспорт после контракта Августа
3. Статус/сводка только авторизованному получателю
4. Сохранение личного демо-чек-ина как отдельного сценария
5. Обновление этой README после появления токена и реального чата

## Переменные окружения (будущие)

- `TELEGRAM_BOT_TOKEN` — только локально, никогда в git
- `VIBEE_API_BASE` + `VIBEE_BOT_TOKEN` — когда появится серверный контракт

## Границы

- Не пишем в SQLite напрямую
- Не считаем метрики в Python
- Не шлём сырые тексты до ACTIVE
- Личный `/stop` демо ≠ отзыв корпоративного согласия
