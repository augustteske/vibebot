import { ActionRecommendationCard } from '../features/actions/ActionRecommendationCard'
import { InsightsWidget } from '../features/insights/InsightsWidget'
import type { InsightsMetrics } from '../features/insights/InsightsWidget'
import './DemoDashboard.css'

interface DemoDashboardProps {
  onBack: () => void;
  onEnter: () => void;
  onCreateTeam: () => void;
}

const demoMetrics: InsightsMetrics = {
  outsideHoursPercent: 25,
  participationEvenness: 89,
  recognitionPercent: 20,
  participantCount: 6,
  messageCount: 120,
}

export function DemoDashboard({ onBack, onEnter, onCreateTeam }: DemoDashboardProps) {
  return (
    <main className="workspace demo-dashboard">
      <header className="demo-dashboard__header">
        <a className="brand" href="/" onClick={event => { event.preventDefault(); onBack() }}>
          <img src="/bee.svg" alt="" />
          Vibee
        </a>
        <div className="demo-dashboard__header-actions">
          <span className="demo-dashboard__badge">ДЕМО-ДАННЫЕ</span>
          <button className="button secondary" onClick={onEnter}>Войти в кабинет</button>
        </div>
      </header>

      <section className="demo-dashboard__hero" aria-labelledby="demo-dashboard-title">
        <div>
          <span className="eyebrow">ПРОДУКТ В ДЕЙСТВИИ · 7 ДНЕЙ</span>
          <h1 id="demo-dashboard-title">Команда<br />«Дизайнеры»</h1>
          <p>Пример того, как общие сигналы помогают команде заметить ритм и договориться о следующем шаге.</p>
        </div>
        <div className="demo-dashboard__quick-stats" aria-label="Параметры демонстрационного периода">
          <article><strong>6</strong><span>вымышленных участников</span></article>
          <article><strong>120</strong><span>синтетических сообщений</span></article>
          <article><strong>3</strong><span>общих показателя</span></article>
        </div>
      </section>

      <div className="demo-dashboard__layout">
        <section className="demo-dashboard__main" aria-label="Метрики и рекомендация">
          <InsightsWidget
            state="published"
            metrics={demoMetrics}
            teamProfile="informal"
            periodLabel="Синтетическая неделя · закрытый период"
            demo
          />
          <ActionRecommendationCard
            observation="В этом вымышленном периоде 25% сообщений команды пришлись на время вне рабочего расписания."
            explanation="Возможно, участникам не всегда ясно, когда ответ можно отложить до следующего рабочего дня."
            limitation="Пример не описывает реальную команду и не позволяет делать выводы о нагрузке отдельных людей."
            suggestedAction="Договориться, какие сообщения действительно требуют ответа вечером, а какие могут подождать до утра."
            dataSource="chat"
            generationSource="template"
            periodLabel="Синтетическая неделя · 7 дней"
            demo
          />
          <p className="demo-dashboard__interaction-note">В демо можно отредактировать и подтвердить шаг. Это действие и отзывы остаются только в браузере.</p>
        </section>

        <aside className="demo-dashboard__aside" aria-label="Как читать демо">
          <section className="panel demo-dashboard__context">
            <span className="demo-dashboard__context-icon" aria-hidden="true">✳</span>
            <h2>От сигнала — к разговору</h2>
            <p>25% сообщений вне расписания — повод обсудить общие ожидания, а не оценивать чей-то вклад.</p>
            <ul>
              <li>89% — равномерность участия</li>
              <li>20% — распознанные благодарности</li>
              <li>Ни одного персонального рейтинга</li>
            </ul>
          </section>
          <section className="demo-dashboard__privacy">
            <span className="eyebrow">БЕЗ РЕГИСТРАЦИИ</span>
            <h2>Только вымышленные данные</h2>
            <p>Этот экран не подключается к Telegram, серверному хранилищу или внешнему ИИ.</p>
          </section>
        </aside>
      </div>

      <section className="demo-dashboard__cta" aria-labelledby="demo-cta-title">
        <div>
          <span className="eyebrow">ВАША КОМАНДА — СЛЕДУЮЩАЯ</span>
          <h2 id="demo-cta-title">Попробуйте пройти путь вместе.</h2>
          <p>Создайте пространство команды, чтобы продолжить в кабинете.</p>
        </div>
        <button className="button" onClick={onCreateTeam}>Создать свою команду <span aria-hidden="true">→</span></button>
      </section>

      <footer className="demo-dashboard__footer">Vibee · Демонстрация на вымышленных данных</footer>
    </main>
  )
}
