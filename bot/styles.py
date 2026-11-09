"""Режимы общения бота: классик, ми-ми-ми и правдарубка.

Режим хранится в состоянии пользователя рядом с языком. В группах всегда
классик: «Правдарубка» с крепким словцом не должна попасть в общий чат.
"""
from __future__ import annotations

CLASSIC = "classic"
CUTE = "cute"
STRAIGHT = "straight"
DEFAULT_STYLE = CLASSIC
STYLES = (CLASSIC, CUTE, STRAIGHT)
PRIVATE_CHAT = "private"


def normalize_style(value: object) -> str | None:
    """Возвращает код режима, если он поддерживается, иначе ``None``."""
    if not isinstance(value, str):
        return None
    code = value.strip().lower()
    return code if code in STYLES else None


def for_chat(style: object, chat_type: object) -> str:
    """Режим для этого чата: в группах — только классик."""
    code = normalize_style(style) or DEFAULT_STYLE
    if code == CLASSIC:
        return CLASSIC
    return code if chat_type == PRIVATE_CHAT else CLASSIC
