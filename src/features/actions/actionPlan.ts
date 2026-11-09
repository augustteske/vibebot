import type { MetricComparisonTrends } from '../../core/telegram'
import type { InsightsMetrics } from '../insights/InsightsWidget'

export type ActionPlanDifficulty = 'easy' | 'medium' | 'hard'

export interface ActionPlanItem {
  id: string
  title: string
  description: string
  difficulty: ActionPlanDifficulty
  estimatedTime: string
  isPriority?: boolean
}

/**
 * Generates an actionable, targeted checklist (3-5 items) based on team communication metrics and trends.
 */
export function generateActionPlan(
  metrics: Partial<InsightsMetrics> | null | undefined,
  trends: MetricComparisonTrends | null | undefined = null,
  seed: number = 0
): ActionPlanItem[] {
  const safeMetrics = metrics && typeof metrics === 'object' ? metrics : {}
  const safeTrends = trends && typeof trends === 'object' ? trends : ((safeMetrics as { trends?: MetricComparisonTrends }).trends || {})

  const outside = safeMetrics.outsideHoursPercent ?? 20
  const unanswered = safeMetrics.unansweredQuestionsPercent ?? 10
  const participation = safeMetrics.participationEvenness ?? 70
  const positivity = safeMetrics.positivityIndex ?? (safeMetrics.recognitionPercent ?? 15)
  const intensity = safeMetrics.intensityIndex ?? 0
  const responseTime = safeMetrics.responseMedianMinutes ?? null

  const items: ActionPlanItem[] = []

  // Rule 1: Outside working hours
  if (outside > 30 || (safeTrends.outsideHoursPercentDiff !== undefined && safeTrends.outsideHoursPercentDiff > 3)) {
    const isPriority = safeTrends.outsideHoursPercentDiff !== undefined && safeTrends.outsideHoursPercentDiff > 0
    items.push({
      id: 'action-outside-hours',
      title: isPriority
        ? '⚠️ Приоритет: Защитить границы рабочего времени'
        : 'Обсудить границы рабочего времени: договориться не писать после 19:00',
      description: 'Договориться не писать в чат после 19:00 и включить тихий режим уведомлений, чтобы снизить усталость команды.',
      difficulty: 'easy',
      estimatedTime: '10 минут',
      isPriority,
    })
  }

  // Rule 2: Unanswered questions
  if (unanswered > 20 || (safeTrends.unansweredQuestionsPercentDiff !== undefined && safeTrends.unansweredQuestionsPercentDiff > 2)) {
    const isPriority = safeTrends.unansweredQuestionsPercentDiff !== undefined && safeTrends.unansweredQuestionsPercentDiff > 0
    items.push({
      id: 'action-unanswered-questions',
      title: isPriority
        ? '⚠️ Приоритет: Снизить число повисших вопросов'
        : 'Выделить 15 минут в день на ответы на вопросы коллег',
      description: 'Ввести короткое фиксированное окно (например, в 11:30 или 16:00), когда каждый участник бегло проверяет чат и отвечает на теги.',
      difficulty: 'easy',
      estimatedTime: '15 минут',
      isPriority,
    })
  }

  // Rule 3: Low positivity / recognition
  if (
    positivity < 10 ||
    (safeTrends.positivityIndexDiff !== undefined && safeTrends.positivityIndexDiff < 0) ||
    (safeTrends.recognitionPercentDiff !== undefined && safeTrends.recognitionPercentDiff < 0)
  ) {
    const isPriority = Boolean(
      (safeTrends.positivityIndexDiff !== undefined && safeTrends.positivityIndexDiff < 0) ||
      (safeTrends.recognitionPercentDiff !== undefined && safeTrends.recognitionPercentDiff < 0)
    )
    items.push({
      id: 'action-positivity',
      title: isPriority
        ? '⚠️ Приоритет: Ввести практику благодарности'
        : 'Ввести практику благодарности: в конце недели отмечать вклад коллег',
      description: 'В пятницу в общем чате или на демо отмечать конкретный вклад коллег и говорить спасибо за выручку и поддержку.',
      difficulty: 'easy',
      estimatedTime: '10 минут',
      isPriority,
    })
  }

  // Rule 4: Participation unevenness
  if (participation < 55 || (safeTrends.participationEvennessDiff !== undefined && safeTrends.participationEvennessDiff < -3)) {
    const isPriority = safeTrends.participationEvennessDiff !== undefined && safeTrends.participationEvennessDiff < 0
    items.push({
      id: 'action-participation',
      title: isPriority
        ? '⚠️ Приоритет: Разобраться с тишиной в обсуждениях'
        : 'Провести ретроспективу: почему некоторые коллеги молчат?',
      description: 'Обсудить на ретро, почему часть команды не участвует в чате: возможно, каналы перегружены или не хватает адресных вопросов.',
      difficulty: 'medium',
      estimatedTime: '30 минут',
      isPriority,
    })
  }

  // Rule 5: High intensity / emotional charge
  if (intensity > 4 || (safeTrends.intensityIndexDiff !== undefined && safeTrends.intensityIndexDiff > 1)) {
    const isPriority = safeTrends.intensityIndexDiff !== undefined && safeTrends.intensityIndexDiff > 0
    items.push({
      id: 'action-intensity',
      title: isPriority
        ? '⚠️ Приоритет: Разрядить эмоциональный накал'
        : 'Перевести спорные вопросы в созвоны 1-on-1',
      description: 'Перевести накопившиеся разногласия из общего текстового чата в короткий созвон тет-а-тет, чтобы снять напряжение.',
      difficulty: 'medium',
      estimatedTime: '20 минут',
      isPriority,
    })
  }

  // Rule 6: Slow response time
  const responseDiff = safeTrends.responseMedianMinutesDiff
  const hasSlowResponseTrend = responseDiff != null && responseDiff > 5
  if (responseTime !== null && (responseTime > 20 || hasSlowResponseTrend)) {
    const isPriority = responseDiff != null && responseDiff > 0
    items.push({
      id: 'action-response-speed',
      title: isPriority
        ? '⚠️ Приоритет: Синхронизировать ожидания по скорости ответа'
        : 'Синхронизировать ожидания по скорости ответа',
      description: 'Определить, какие каналы требуют быстрого ответа (до 15 минут), а какие допускают асинхронную реакцию в течение полудня.',
      difficulty: 'easy',
      estimatedTime: '15 минут',
      isPriority,
    })
  }

  // Proactive fallback steps to always guarantee 3-5 high-value steps
  const fallbacks: ActionPlanItem[] = [
    {
      id: 'action-kudos-board',
      title: 'Запустить виртуальную доску признания (Kudos Board)',
      description: 'Создать закреплённое сообщение в чате для спонтанных спасиб и тёплых отзывов о совместных победах.',
      difficulty: 'easy',
      estimatedTime: '10 минут',
      isPriority: false,
    },
    {
      id: 'action-team-rules',
      title: 'Описать правила командной гигиены общения в Notion/Wiki',
      description: 'Зафиксировать текущие отличные договорённости: тихие часы, шаблон формулировки вопросов и правила тегов.',
      difficulty: 'medium',
      estimatedTime: '25 минут',
      isPriority: false,
    },
    {
      id: 'action-coffee-break',
      title: 'Устроить неформальный 15-минутный coffee-break',
      description: 'Провести легкий созвон без рабочих повесток, чтобы пообщаться на свободные темы и укрепить доверие.',
      difficulty: 'easy',
      estimatedTime: '15 минут',
      isPriority: false,
    },
    {
      id: 'action-retro-celebrate',
      title: 'Отпраздновать высокий командный индекс на ретро',
      description: 'Подвести итоги недели и похвалить команду за высокий комфорт общения и зрелый ритм.',
      difficulty: 'easy',
      estimatedTime: '10 минут',
      isPriority: false,
    },
    {
      id: 'action-focus-hours',
      title: 'Ввести командные «часы глубокой концентрации» (Focus Time)',
      description: 'Договориться о 2 часах без звонков и несрочных сообщений, когда каждый погружён в сложные задачи.',
      difficulty: 'medium',
      estimatedTime: '20 минут',
      isPriority: false,
    },
  ]

  // If a seed was used (e.g. regenerating the plan), rotate fallbacks to offer fresh alternatives
  const rotatedFallbacks = seed > 0
    ? [...fallbacks.slice(seed % fallbacks.length), ...fallbacks.slice(0, seed % fallbacks.length)]
    : fallbacks

  for (const fallback of rotatedFallbacks) {
    if (items.length >= 3) break
    if (!items.some(i => i.id === fallback.id)) {
      items.push(fallback)
    }
  }

  // Priority items sorted first, capped at 5
  items.sort((a, b) => (b.isPriority ? 1 : 0) - (a.isPriority ? 1 : 0))

  return items.slice(0, 5)
}
