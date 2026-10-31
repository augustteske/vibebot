"""Durable transport-gap latch. Contains no message text or credentials."""

import json
import os
from pathlib import Path


class PauseState:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path
        self.stage = "clear"
        self.pause_revision: int | None = None
        if path is not None and path.exists():
            try:
                saved = json.loads(path.read_text(encoding="utf-8"))
                if saved.get("stage") in {"needed", "awaiting_resume"}:
                    self.stage = saved["stage"]
                    revision = saved.get("pause_revision")
                    self.pause_revision = revision if type(revision) is int and revision >= 0 else None
                else:
                    self.stage = "needed"
            except (OSError, ValueError, TypeError, AttributeError):
                self.stage = "needed"

    def need_pause(self) -> None:
        self.stage = "needed"
        self.pause_revision = None
        self._save()

    def confirmed(self, revision: int) -> None:
        self.stage = "awaiting_resume"
        self.pause_revision = revision
        self._save()

    def clear(self) -> None:
        self.stage = "clear"
        self.pause_revision = None
        if self.path is not None:
            self.path.unlink(missing_ok=True)

    def _save(self) -> None:
        if self.path is None:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(self.path.suffix + ".tmp")
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump({"stage": self.stage, "pause_revision": self.pause_revision}, stream)
        os.replace(temporary, self.path)
