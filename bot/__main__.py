"""
Точка входа.

Пока только --check и запуск тестов.
Реальный aiogram polling подключим после того, как Август даст контракт
и появится токен + тестовый чат.
"""

from __future__ import annotations

import argparse
import sys
import unittest


def run_check() -> int:
    """Быстрая проверка без токена и сети."""
    print("vibee-bot check: consent + transport gate")
    loader = unittest.TestLoader()
    suite = loader.discover("bot/tests", pattern="test_*.py")
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    return 0 if result.wasSuccessful() else 1


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m bot")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Запустить локальные проверки без Telegram и сети",
    )
    args = parser.parse_args()

    if args.check:
        sys.exit(run_check())

    print(
        "Реальный polling пока не включён.\n"
        "Сначала: python -m bot --check\n"
        "Потом ждём контракт от Августа + токен + тестовый чат."
    )
    sys.exit(0)


if __name__ == "__main__":
    main()