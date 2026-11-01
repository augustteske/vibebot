"""Short-lived demo state. No messages, chat history or disk persistence."""
from dataclasses import dataclass, field
import secrets
import time

QUESTIONS = (
    ("energy", "Сколько сил на работу сегодня?"),
    ("clarity", "Насколько понятно, что сейчас главное?"),
    ("support", "Насколько легко сейчас попросить помощи?"),
)


@dataclass
class Draft:
    nonce: str
    expires: float
    step: int = -1
    values: dict[str, int] = field(default_factory=dict)


class CheckinFlow:
    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.drafts: dict[int, Draft] = {}

    def expire(self):
        for user in list(self.drafts):
            if self.drafts[user].expires <= self.clock():
                self.cancel(user)

    def begin(self, user):
        self.expire()
        nonce = secrets.token_hex(8)
        self.drafts[user] = Draft(nonce, self.clock() + 300)
        return nonce

    def _current(self, user, nonce):
        self.expire()
        draft = self.drafts.get(user)
        if draft is None or draft.nonce != nonce:
            raise ValueError("Этот чек-ин истёк. Начните заново: /start")
        return draft

    def consent(self, user, nonce, accepted):
        draft = self._current(user, nonce)
        if draft.step != -1:
            raise ValueError("Выбор уже обработан")
        if not accepted:
            self.cancel(user)
            return False
        draft.step = 0
        return True

    def answer(self, user, nonce, step, value):
        draft = self._current(user, nonce)
        if draft.step != step or step not in range(3):
            raise ValueError("Эта кнопка устарела. Ответьте на текущий вопрос.")
        if type(value) is not int or value not in range(1, 6):
            raise ValueError("Выберите целую оценку от 1 до 5")
        draft.values[QUESTIONS[step][0]] = value
        draft.step += 1
        if draft.step == 3:
            result = draft.values.copy()
            self.cancel(user)
            return result
        return None

    def cancel(self, user):
        self.drafts.pop(user, None)
