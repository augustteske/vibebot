import type { ExtendedAnalyticsMetrics } from '../../core/telegram'
import type { InsightsMetrics } from './InsightsWidget'

export interface TeamHealthGradation {
  title: string
  subtitle: string
  zone: 'paradise' | 'hive' | 'attention' | 'risk'
  badgeColor: string
}

/**
 * Computes the overall Team Health Score (0-100) combining communication metrics.
 * 100 is ideal healthy balance, 0 is critical risk.
 */
export function calculateTeamHealthScore(metrics: Partial<InsightsMetrics> | null | undefined): number {
  if (!metrics || typeof metrics !== 'object') {
    return 50
  }

  let score = 50

  // 1. Participation evenness (0..100)
  const participation = typeof metrics.participationEvenness === 'number'
    ? metrics.participationEvenness
    : 70
  if (participation > 70) {
    score += Math.min(15, (participation - 70) * 0.5)
  } else if (participation < 50) {
    score -= Math.min(15, (50 - participation) * 0.5)
  }

  // 2. Outside hours percent (0..100)
  const outside = typeof metrics.outsideHoursPercent === 'number'
    ? metrics.outsideHoursPercent
    : 20
  if (outside < 20) {
    score += Math.min(15, (20 - outside) * 0.75)
  } else if (outside > 30) {
    score -= Math.min(20, (outside - 30) * 0.5)
  }

  // 3. Positivity / Recognition (0..100)
  const positive = typeof metrics.positivityIndex === 'number'
    ? metrics.positivityIndex
    : (typeof metrics.recognitionPercent === 'number' ? metrics.recognitionPercent : 10)
  if (positive > 10) {
    score += Math.min(15, (positive - 10) * 0.6)
  } else if (positive < 3) {
    score -= 5
  }

  // 4. Intensity index (0..100)
  const intensity = typeof metrics.intensityIndex === 'number'
    ? metrics.intensityIndex
    : 0
  if (intensity > 5) {
    score -= Math.min(20, (intensity - 5) * 2)
  }

  // 5. Unanswered questions percent (0..100)
  const unanswered = typeof metrics.unansweredQuestionsPercent === 'number'
    ? metrics.unansweredQuestionsPercent
    : 15
  if (unanswered > 20) {
    score -= Math.min(20, (unanswered - 20) * 0.6)
  } else if (unanswered <= 10) {
    score += 5
  }

  return Math.max(0, Math.min(100, Math.round(score)))
}

/**
 * Returns gradation details based on the Team Health Score.
 * 80–100: «Пчелиный рай»
 * 50–79: «Рабочий улей»
 * 20–49: «Требуется внимание»
 * 0–19: «Зона риска»
 */
export function getTeamHealthGradation(score: number): TeamHealthGradation {
  if (score >= 80) {
    return {
      title: 'Пчелиный рай',
      subtitle: 'Отличный баланс и высокая культура взаимной поддержки',
      zone: 'paradise',
      badgeColor: '#27ae60',
    }
  }
  if (score >= 50) {
    return {
      title: 'Рабочий улей',
      subtitle: 'Здоровый рабочий ритм, всё в порядке, есть куда расти',
      zone: 'hive',
      badgeColor: '#f39c12',
    }
  }
  if (score >= 20) {
    return {
      title: 'Требуется внимание',
      subtitle: 'Заметны перекосы в нагрузке или коммуникации',
      zone: 'attention',
      badgeColor: '#e67e22',
    }
  }
  return {
    title: 'Зона риска',
    subtitle: 'Высокое напряжение, стоит срочно обсудить с командой',
    zone: 'risk',
    badgeColor: '#e74c3c',
  }
}

/**
 * Returns an actionable, empathetic tip tailored to the team's lowest metric.
 */
export function getTeamHealthAdvice(
  metrics: InsightsMetrics | null | undefined,
  extendedMetrics?: ExtendedAnalyticsMetrics | null
): string {
  if (!metrics) {
    return 'Данные о команде собираются. Со временем здесь появятся персональные рекомендации по улучшению атмосферы.'
  }

  const ext = extendedMetrics ?? (metrics as unknown as ExtendedAnalyticsMetrics | undefined)
  const unanswered = ext?.unansweredQuestionsPercent ?? metrics.unansweredQuestionsPercent
  const outside = metrics.outsideHoursPercent
  const participation = metrics.participationEvenness
  const intensity = ext?.intensityIndex ?? metrics.intensityIndex
  const positivity = ext?.positivityIndex ?? metrics.positivityIndex
  const recognition = metrics.recognitionPercent

  // 1. Critical unanswered questions
  if (unanswered !== undefined && unanswered > 20) {
    return `Многие вопросы (${unanswered}% со знаком «?») остаются без ответа за сутки. Попробуйте выделить время на синхронный синк или запустить дежурство по чату.`
  }

  // 2. Heavy after-hours communication
  if (outside !== undefined && outside > 30) {
    return `Около ${outside}% сообщений приходится на нерабочее время. Обсудите границы доступности, чтобы снизить риск эмоционального выгорания.`
  }

  // 3. Uneven participation (few people speaking)
  if (participation !== undefined && participation < 60) {
    return `Вовлечённость снижена (${participation}%): в основном говорят 1–2 человека. Попробуйте вовлекать молчаливых коллег адресными вопросами.`
  }

  // 4. Elevated intensity / conflict
  if (intensity !== undefined && intensity > 5) {
    return `Повышен индекс накала (${intensity}% реплик). Рекомендуем перевести спорные вопросы в личный созвон 1-on-1, чтобы снять напряжение.`
  }

  // 5. Low positivity / recognition
  if ((positivity !== undefined && positivity < 8) || (positivity === undefined && recognition < 10)) {
    return `В диалогах мало слов благодарности и поддержки. Простое спасибо за закрытую задачу сильно повышает мотивацию и теплоту в команде.`
  }

  // 6. Healthy balance default
  return `Отличный баланс в общении! Команда на одной волне, ритм комфортный и продуктивный. Продолжайте поддерживать друг друга.`
}
