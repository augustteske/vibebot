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
  metrics?: {
    outsideHoursPercent: number;
    participationEvenness: number;
  };
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
  metrics,
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
        <div className="vibee-arc__title-row">
          <span className="vibee-arc__icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
            </svg>
          </span>
          <h3 id="vibee-arc-title" className="vibee-arc__title">Рекомендация</h3>
        </div>
        <div className="vibee-arc__badges">
          {demo && <span className="vibee-arc__badge vibee-arc__badge--demo">демо-данные</span>}
          <span className="vibee-arc__badge">источник данных: {DATA_SOURCE_LABEL[dataSource]}</span>
          <span className="vibee-arc__badge">источник генерации: {GENERATION_LABEL[generationSource]}</span>
        </div>
        <p className="vibee-arc__period">{periodLabel}</p>
      </header>

      <div className="vibee-arc__action">
        <p className="vibee-arc__action-label">
          <span className="vibee-arc__action-icon" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <path d="m10 8 4 4-4 4"/>
            </svg>
          </span>
          Предлагаемый следующий шаг
        </p>
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

      <details className="vibee-arc__why">
        <summary className="vibee-arc__why-summary">
          <span className="vibee-arc__why-title">Почему такой вывод?</span>
          <span className="vibee-arc__why-chevron" aria-hidden="true" />
        </summary>
        <div className="vibee-arc__why-body">
          <div className="vibee-arc__why-content">
            <dl className="vibee-arc__blocks">
              <div className="vibee-arc__block">
                <dt>Наблюдение</dt>
                <dd>{observation}</dd>
              </div>
              <div className="vibee-arc__block">
                <dt>Возможное объяснение</dt>
                <dd>{explanation}</dd>
              </div>
            </dl>
            <p className="vibee-arc__why-intro">Показатели опубликованного периода:</p>
            {metrics ? (
              <dl className="vibee-arc__metrics">
                <div>
                  <dt>Сообщения вне рабочих часов</dt>
                  <dd>{metrics.outsideHoursPercent.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%</dd>
                </div>
                <div>
                  <dt>Равномерность участия</dt>
                  <dd>{metrics.participationEvenness.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%</dd>
                </div>
              </dl>
            ) : (
              <p className="vibee-arc__why-note">Показатели для этого периода недоступны.</p>
            )}
            <div className="vibee-arc__limitation">
              <h4>Ограничение интерпретации</h4>
              <p>{limitation}</p>
            </div>
            <p className="vibee-arc__why-note">
              Эти агрегаты не объясняют причины изменений и не оценивают отдельных людей.
            </p>
          </div>
        </div>
      </details>

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
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 6 9 17l-5-5"/>
              </svg>
              Принять
            </button>
            {phase === 'review' ? (
              <button
                type="button"
                className="vibee-arc__btn"
                onClick={() => { setError(null); setPhase('editing'); }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                </svg>
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
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
              Позже
            </button>
            <button
              type="button"
              className="vibee-arc__btn vibee-arc__btn--quiet"
              onClick={() => { setError(null); setPhase('rejected'); onReject?.(); }}
              disabled={busy}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12"/>
              </svg>
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
