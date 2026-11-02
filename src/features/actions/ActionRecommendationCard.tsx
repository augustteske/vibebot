import { useEffect, useRef, useState } from 'react';
import './ActionRecommendationCard.css';

export type ActionDataSource = 'checkin' | 'chat';
export type ActionGenerationSource = 'ai' | 'template';
export type InterpretationFeedback = 'useful' | 'incorrect' | 'usual_joke';
export type ActionOutcomeFeedback = 'helped' | 'not_helped';

export interface ActionRecommendationCardProps {
  observation?: string;
  explanation?: string;
  limitation?: string;
  suggestedAction?: string;
  dataSource?: ActionDataSource;
  generationSource?: ActionGenerationSource;
  periodLabel?: string;
  /** Пока true — карточка обязана явно называть себя демо. По умолчанию true. */
  demo?: boolean;
  onConfirm?: (payload: { action: string; edited: boolean }) => Promise<void> | void;
  onLater?: () => void;
  onReject?: () => void;
  onInterpretationFeedback?: (value: InterpretationFeedback) => Promise<void> | void;
  onActionFeedback?: (value: ActionOutcomeFeedback) => Promise<void> | void;
}

const DATA_SOURCE_LABEL: Record<ActionDataSource, string> = {
  checkin: 'чек-ин',
  chat: 'чат-утилита',
};

const GENERATION_LABEL: Record<ActionGenerationSource, string> = {
  ai: 'ИИ',
  template: 'шаблон',
};

const INTERPRETATION_LABEL: Record<InterpretationFeedback, string> = {
  useful: 'Полезно',
  incorrect: 'Неверная интерпретация',
  usual_joke: 'Обычная шутка',
};

const OUTCOME_LABEL: Record<ActionOutcomeFeedback, string> = {
  helped: 'Помогло',
  not_helped: 'Не помогло',
};

type Phase = 'review' | 'editing' | 'saving' | 'accepted' | 'later' | 'rejected';

export function ActionRecommendationCard({
  observation = 'В закрытом периоде стало больше сообщений вне рабочего времени.',
  explanation = 'Возможно, изменились ожидания по доступности.',
  limitation = 'Показатель не доказывает перегрузку: срочные задачи или неверное расписание могли повлиять на картину.',
  suggestedAction = 'Обсудить с командой, в какие часы ответ можно отложить до следующего рабочего дня.',
  dataSource = 'chat',
  generationSource = 'template',
  periodLabel = 'период: демо, 7 дней',
  demo = true,
  onConfirm,
  onLater,
  onReject,
  onInterpretationFeedback,
  onActionFeedback,
}: ActionRecommendationCardProps) {
  const [phase, setPhase] = useState<Phase>('review');
  const [actionText, setActionText] = useState(suggestedAction);
  const [acceptedAction, setAcceptedAction] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [interpretation, setInterpretation] = useState<InterpretationFeedback | null>(null);
  const [outcome, setOutcome] = useState<ActionOutcomeFeedback | null>(null);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const editRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (phase === 'editing') editRef.current?.focus();
  }, [phase]);

  const edited = actionText.trim() !== suggestedAction.trim();
  const busy = phase === 'saving';

  async function handleConfirm() {
    if (busy) return;
    const next = actionText.trim();
    if (!next) {
      setError('Шаг не может быть пустым. Впишите формулировку или нажмите «Отмена».');
      return;
    }
    setError(null);
    setPhase('saving');
    try {
      await onConfirm?.({ action: next, edited });
      setAcceptedAction(next);
      setPhase('accepted');
    } catch {
      // Ввод не теряем: возвращаемся в редактирование с тем же текстом.
      setError('Не удалось подтвердить действие. Проверьте соединение и попробуйте снова.');
      setPhase(edited ? 'editing' : 'review');
    }
  }

  async function sendFeedback<T>(value: T, cb: ((v: T) => Promise<void> | void) | undefined, accept: (value: T) => void) {
    if (feedbackBusy) return;
    setFeedbackBusy(true);
    setError(null);
    try {
      await cb?.(value);
      accept(value);
    } catch {
      setError('Не удалось отправить отзыв. Попробуйте ещё раз.');
    } finally {
      setFeedbackBusy(false);
    }
  }

  const cardClass = ['vibee-arc', `vibee-arc--${phase}`].join(' ');

  return (
    <section className={cardClass} aria-labelledby="vibee-arc-title">
      <header className="vibee-arc__head">
        <h3 id="vibee-arc-title" className="vibee-arc__title">Рекомендация</h3>
        <div className="vibee-arc__badges">
          {demo && <span className="vibee-arc__badge vibee-arc__badge--demo">демо-данные</span>}
          <span className="vibee-arc__badge">источник данных: {DATA_SOURCE_LABEL[dataSource]}</span>
          <span className="vibee-arc__badge">источник генерации: {GENERATION_LABEL[generationSource]}</span>
        </div>
        <p className="vibee-arc__period">{periodLabel}</p>
      </header>

      <dl className="vibee-arc__blocks">
        <div className="vibee-arc__block">
          <dt>Наблюдение</dt>
          <dd>{observation}</dd>
        </div>
        <div className="vibee-arc__block">
          <dt>Возможное объяснение</dt>
          <dd>{explanation}</dd>
        </div>
        <div className="vibee-arc__block">
          <dt>Ограничение</dt>
          <dd>{limitation}</dd>
        </div>
      </dl>

      <div className="vibee-arc__action">
        <p className="vibee-arc__action-label">Предлагаемый следующий шаг</p>
        {phase === 'editing' || phase === 'saving' ? (
          <>
            <label className="vibee-arc__visually-hidden" htmlFor="vibee-arc-action-input">
              Сформулируйте следующий шаг
            </label>
            <textarea
              id="vibee-arc-action-input"
              ref={editRef}
              className="vibee-arc__textarea"
              value={actionText}
              rows={3}
              disabled={busy}
              onChange={(e) => setActionText(e.target.value)}
            />
            <p className="vibee-arc__hint">
              Пока не нажато «Принять», текст никуда не отправляется.
            </p>
          </>
        ) : (
          <p className="vibee-arc__action-text">{acceptedAction || actionText}</p>
        )}
      </div>

      {error && (
        <p className="vibee-arc__error" role="alert">{error}</p>
      )}

      <div className="vibee-arc__controls" aria-live="polite">
        {(phase === 'review' || phase === 'editing') && (
          <>
            <button
              type="button"
              className="vibee-arc__btn vibee-arc__btn--primary"
              onClick={handleConfirm}
              disabled={busy}
            >
              Принять
            </button>
            {phase === 'review' ? (
              <button
                type="button"
                className="vibee-arc__btn"
                onClick={() => { setError(null); setPhase('editing'); }}
              >
                Изменить шаг
              </button>
            ) : (
              <button
                type="button"
                className="vibee-arc__btn"
                onClick={() => { setError(null); setActionText(suggestedAction); setPhase('review'); }}
                disabled={busy}
              >
                Отмена
              </button>
            )}
            <button
              type="button"
              className="vibee-arc__btn"
              onClick={() => { setError(null); setPhase('later'); onLater?.(); }}
              disabled={busy}
            >
              Позже
            </button>
            <button
              type="button"
              className="vibee-arc__btn vibee-arc__btn--quiet"
              onClick={() => { setError(null); setPhase('rejected'); onReject?.(); }}
              disabled={busy}
            >
              Не подходит
            </button>
          </>
        )}

        {phase === 'saving' && <p className="vibee-arc__status">Подтверждаем…</p>}

        {phase === 'later' && (
          <>
            <p className="vibee-arc__status">Отложено. Ничего не отправлено.</p>
            <button
              type="button"
              className="vibee-arc__btn"
              onClick={() => setPhase('review')}
            >
              Вернуться к карточке
            </button>
          </>
        )}

        {phase === 'rejected' && (
          <>
            <p className="vibee-arc__status">Отклонено. Ничего не отправлено.</p>
            <button
              type="button"
              className="vibee-arc__btn"
              onClick={() => setPhase('review')}
            >
              Вернуть карточку
            </button>
          </>
        )}

        {phase === 'accepted' && (
          <>
            <p className="vibee-arc__status vibee-arc__status--ok">
              Принято{demo ? ' (демо: на сервере не сохранено)' : ''}
            </p>

            <fieldset className="vibee-arc__feedback">
              <legend>Насколько верна интерпретация?</legend>
              {(Object.keys(INTERPRETATION_LABEL) as InterpretationFeedback[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  className="vibee-arc__btn vibee-arc__btn--chip"
                  aria-pressed={interpretation === key}
                  disabled={feedbackBusy}
                  onClick={() => {
                    void sendFeedback(key, onInterpretationFeedback, setInterpretation);
                  }}
                >
                  {INTERPRETATION_LABEL[key]}
                </button>
              ))}
            </fieldset>

            <fieldset className="vibee-arc__feedback">
              <legend>Позже: помогло ли действие?</legend>
              {(Object.keys(OUTCOME_LABEL) as ActionOutcomeFeedback[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  className="vibee-arc__btn vibee-arc__btn--chip"
                  aria-pressed={outcome === key}
                  disabled={feedbackBusy}
                  onClick={() => {
                    void sendFeedback(key, onActionFeedback, setOutcome);
                  }}
                >
                  {OUTCOME_LABEL[key]}
                </button>
              ))}
            </fieldset>
          </>
        )}
      </div>

      <p className="vibee-arc__note">
        Карточка не ставит диагнозов и не оценивает людей. Наблюдение, объяснение и ограничение —
        разные вещи; решение принимает человек.
      </p>
    </section>
  );
}

export default ActionRecommendationCard;
