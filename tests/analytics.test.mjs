import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isQuestionMessage,
  calculateUnansweredQuestionsPercent,
  calculateResponseMedianMinutes,
  isPositiveMessage,
  calculatePositivityIndex,
  isIntensityMessage,
  calculateIntensityIndex,
  createActivityDistribution,
  recordActivity,
  calculateComparisonTrends,
  calculateTeamHealthScore,
  generateActionPlan,
  calculateAchievements,
} from '../server/analytics.mjs'

test('analytics: isQuestionMessage accurately identifies questions', () => {
  assert.equal(isQuestionMessage('Привет, как дела?'), true)
  assert.equal(isQuestionMessage('Кто дежурный сегодня?'), true)
  assert.equal(isQuestionMessage('¿Que pasa?'), true)
  assert.equal(isQuestionMessage('Обычное сообщение без вопроса.'), false)
  assert.equal(isQuestionMessage(null), false)
  assert.equal(isQuestionMessage(''), false)
})

test('analytics: calculateUnansweredQuestionsPercent computes correct ratios', () => {
  assert.equal(calculateUnansweredQuestionsPercent(2, 10), 20)
  assert.equal(calculateUnansweredQuestionsPercent(1, 3), 33.3)
  assert.equal(calculateUnansweredQuestionsPercent(0, 5), 0)
  assert.equal(calculateUnansweredQuestionsPercent(0, 0), 0)

  assert.throws(() => calculateUnansweredQuestionsPercent(-1, 5), RangeError)
  assert.throws(() => calculateUnansweredQuestionsPercent(6, 5), RangeError)
})

test('analytics: calculateResponseMedianMinutes computes correct median time', () => {
  // Empty or invalid
  assert.equal(calculateResponseMedianMinutes([]), null)
  assert.equal(calculateResponseMedianMinutes(null), null)

  // Single response: 120s = 2.0m
  assert.equal(calculateResponseMedianMinutes([120]), 2)

  // Odd count: 60s, 180s, 300s -> median is 180s = 3.0m
  assert.equal(calculateResponseMedianMinutes([60, 180, 300]), 3)

  // Even count: 60s, 120s, 240s, 360s -> median is (120 + 240)/2 = 180s = 3.0m
  assert.equal(calculateResponseMedianMinutes([360, 60, 240, 120]), 3)

  // Sub-minute precision: 90s = 1.5m
  assert.equal(calculateResponseMedianMinutes([90]), 1.5)
})

test('analytics: isPositiveMessage identifies appreciation and encouragement vocabulary', () => {
  assert.equal(isPositiveMessage('Спасибо огромное за помощь!'), true)
  assert.equal(isPositiveMessage('Супер, отличная работа!'), true)
  assert.equal(isPositiveMessage('Thanks, great job!'), true)
  assert.equal(isPositiveMessage('Команда, вы молодцы!'), true)
  assert.equal(isPositiveMessage('Пулреквест проверен.'), false)
  assert.equal(isPositiveMessage(null), false)
})

test('analytics: calculatePositivityIndex computes frequency percentage', () => {
  assert.equal(calculatePositivityIndex(5, 20), 25)
  assert.equal(calculatePositivityIndex(1, 3), 33.3)
  assert.equal(calculatePositivityIndex(0, 10), 0)

  assert.throws(() => calculatePositivityIndex(-1, 10), RangeError)
  assert.throws(() => calculatePositivityIndex(12, 10), RangeError)
  assert.throws(() => calculatePositivityIndex(0, 0), RangeError)
})

test('analytics: isIntensityMessage identifies emotional/slang vocabulary without saving words', () => {
  assert.equal(isIntensityMessage('Блин, опять падает сервер'), true)
  assert.equal(isIntensityMessage('Это какая-то жесть и капец'), true)
  assert.equal(isIntensityMessage('What the wtf happened'), true)
  assert.equal(isIntensityMessage('Спокойно правим баг.'), false)
  assert.equal(isIntensityMessage(null), false)
})

test('analytics: calculateIntensityIndex computes ratio of intense messages', () => {
  assert.equal(calculateIntensityIndex(2, 50), 4)
  assert.equal(calculateIntensityIndex(0, 30), 0)

  assert.throws(() => calculateIntensityIndex(-1, 20), RangeError)
  assert.throws(() => calculateIntensityIndex(25, 20), RangeError)
  assert.throws(() => calculateIntensityIndex(0, 0), RangeError)
})

test('analytics: recordActivity tracks aggregate day and hour counts without attribution', () => {
  const dist = createActivityDistribution()
  assert.equal(dist.byDay['Пн'], 0)
  assert.equal(dist.byHour[10], 0)

  // 2026-11-09 is a Monday (10:30 UTC)
  const mondayTs = Date.parse('2026-11-09T10:30:00.000Z')
  recordActivity(dist, mondayTs, 'UTC')
  assert.equal(dist.byDay['Пн'], 1)
  assert.equal(dist.byHour[10], 1)

  // Another Monday message at 10:45 UTC
  const mondayTs2 = Date.parse('2026-11-09T10:45:00.000Z')
  recordActivity(dist, mondayTs2, 'UTC')
  assert.equal(dist.byDay['Пн'], 2)
  assert.equal(dist.byHour[10], 2)
})

test('analytics: calculateComparisonTrends calculates diffs between periods', () => {
  const current = {
    outsideHoursPercent: 18,
    participationEvenness: 85,
    recognitionPercent: 22,
    unansweredQuestionsPercent: 8,
    responseMedianMinutes: 4.5,
    positivityIndex: 30,
    intensityIndex: 2,
  }
  const previous = {
    outsideHoursPercent: 25,
    participationEvenness: 80,
    recognitionPercent: 20,
    unansweredQuestionsPercent: 12,
    responseMedianMinutes: 6.0,
    positivityIndex: 25,
    intensityIndex: 5,
  }

  const diff = calculateComparisonTrends(current, previous)
  assert.deepEqual(diff, {
    outsideHoursPercentDiff: -7,
    participationEvennessDiff: 5,
    recognitionPercentDiff: 2,
    unansweredQuestionsPercentDiff: -4,
    responseMedianMinutesDiff: -1.5,
    positivityIndexDiff: 5,
    intensityIndexDiff: -3,
  })

  assert.equal(calculateComparisonTrends(null, previous), null)
  assert.equal(calculateComparisonTrends(current, null), null)
})

test('analytics: conversational simulation correctly calculates aggregates', () => {
  // Simulate a realistic flow of messages between authors
  const messages = [
    { senderId: 'user1', text: 'Коллеги, доброе утро! Как успехи по релизу?', sentAt: '2026-11-09T09:00:00.000Z' },
    { senderId: 'user2', text: 'Привет! Всё отлично, тесты зелёные, спасибо команде!', sentAt: '2026-11-09T09:03:00.000Z' },
    { senderId: 'user3', text: 'Супер новость! Классная работа.', sentAt: '2026-11-09T09:05:00.000Z' },
    { senderId: 'user1', text: 'Блин, кажется упал один скрипт деплоя', sentAt: '2026-11-09T09:10:00.000Z' },
    { senderId: 'user2', text: 'Сейчас поправлю, уже смотрю.', sentAt: '2026-11-09T09:12:00.000Z' },
  ]

  let questionCount = 0
  let unansweredCount = 0
  let positiveCount = 0
  let intensityCount = 0
  const deltas = []
  const dist = createActivityDistribution()

  let lastSenderId = null
  let lastSentAt = null

  for (const msg of messages) {
    const isQ = isQuestionMessage(msg.text)
    const isPos = isPositiveMessage(msg.text)
    const isIntensity = isIntensityMessage(msg.text)
    const sentAtMillis = Date.parse(msg.sentAt)

    if (isQ) questionCount++
    if (isPos) positiveCount++
    if (isIntensity) intensityCount++

    if (lastSenderId && lastSenderId !== msg.senderId && lastSentAt) {
      const deltaSec = Math.max(0, Math.round((sentAtMillis - lastSentAt) / 1000))
      deltas.push(deltaSec)
      if (unansweredCount > 0) unansweredCount--
    }

    if (isQ) unansweredCount++

    recordActivity(dist, msg.sentAt, 'UTC')
    lastSenderId = msg.senderId
    lastSentAt = sentAtMillis
  }

  // 1 question was asked by user1, answered by user2 3 mins later
  assert.equal(questionCount, 1)
  assert.equal(unansweredCount, 0)
  assert.equal(calculateUnansweredQuestionsPercent(unansweredCount, questionCount), 0)

  // 2 positive messages (user2: "отлично... спасибо", user3: "Супер... Классная")
  assert.equal(positiveCount, 2)
  assert.equal(calculatePositivityIndex(positiveCount, messages.length), 40)

  // 1 intensity message (user1: "Блин...")
  assert.equal(intensityCount, 1)
  assert.equal(calculateIntensityIndex(intensityCount, messages.length), 20)

  // Response times:
  // user1 -> user2: 3 min (180s)
  // user2 -> user3: 2 min (120s)
  // user3 -> user1: 5 min (300s)
  // user1 -> user2: 2 min (120s)
  // Deltas in seconds: [180, 120, 300, 120]. Sorted: [120, 120, 180, 300].
  // Median: (120 + 180) / 2 = 150s = 2.5 min
  assert.deepEqual(deltas, [180, 120, 300, 120])
  assert.equal(calculateResponseMedianMinutes(deltas), 2.5)

  // Activity: Monday 09:00 hour has all 5 messages
  assert.equal(dist.byDay['Пн'], 5)
  assert.equal(dist.byHour[9], 5)
})

test('analytics: calculateTeamHealthScore correctly handles normal, edge, and extreme values', () => {
  // Empty / null metrics returns default 50
  assert.equal(calculateTeamHealthScore(null), 50)
  assert.equal(calculateTeamHealthScore({}), 50)

  // Ideal team: 100% participation, 0% outside hours, 35% positivity, 0% intensity, 0% unanswered questions
  const idealTeam = {
    participationEvenness: 100,
    outsideHoursPercent: 0,
    positivityIndex: 35,
    intensityIndex: 0,
    unansweredQuestionsPercent: 0,
  }
  assert.equal(calculateTeamHealthScore(idealTeam), 100)

  // Critical risk team: 10% participation, 70% outside hours, 0% positivity, 25% intensity, 65% unanswered questions
  const worstTeam = {
    participationEvenness: 10,
    outsideHoursPercent: 70,
    positivityIndex: 0,
    intensityIndex: 25,
    unansweredQuestionsPercent: 65,
  }
  assert.equal(calculateTeamHealthScore(worstTeam), 0)

  // Demo team metrics: solid balanced healthy team
  const demoTeam = {
    participationEvenness: 89,
    outsideHoursPercent: 25,
    positivityIndex: 28.4,
    intensityIndex: 1.8,
    unansweredQuestionsPercent: 8.5,
  }
  const demoScore = calculateTeamHealthScore(demoTeam)
  assert.ok(demoScore >= 75 && demoScore <= 85, `Demo score was ${demoScore}, expected ~76-80`)

  // Fallback to recognitionPercent if positivityIndex is absent
  const recognitionTeam = {
    participationEvenness: 90,
    outsideHoursPercent: 15,
    recognitionPercent: 25,
    unansweredQuestionsPercent: 5,
  }
  const recognitionScore = calculateTeamHealthScore(recognitionTeam)
  assert.ok(recognitionScore > 75, `Expected recognitionScore > 75, got ${recognitionScore}`)

  // High intensity penalty check
  const highIntensityTeam = {
    participationEvenness: 70,
    outsideHoursPercent: 20,
    intensityIndex: 15,
    unansweredQuestionsPercent: 15,
  }
  // Base 50 - min(20, (15 - 5) * 2) = 50 - 20 = 30
  assert.equal(calculateTeamHealthScore(highIntensityTeam), 30)
})

test('analytics: generateActionPlan generates targeted action items based on metrics and priority trends', () => {
  // Test 1: Team with bad outside hours, bad unanswered questions, and low positivity
  const troubledTeam = {
    outsideHoursPercent: 35,
    unansweredQuestionsPercent: 25,
    positivityIndex: 6,
    participationEvenness: 48,
    intensityIndex: 6,
  }
  const plan1 = generateActionPlan(troubledTeam)
  assert.ok(plan1.length >= 3 && plan1.length <= 5, 'Plan should contain 3-5 items')

  const ids1 = plan1.map(item => item.id)
  assert.ok(ids1.includes('action-outside-hours'), 'Should include outside hours action')
  assert.ok(ids1.includes('action-unanswered-questions'), 'Should include unanswered questions action')
  assert.ok(ids1.includes('action-positivity'), 'Should include positivity action')
  assert.ok(ids1.includes('action-participation'), 'Should include participation action')

  // Check required item properties
  for (const item of plan1) {
    assert.ok(typeof item.id === 'string' && item.id.length > 0)
    assert.ok(typeof item.title === 'string' && item.title.length > 0)
    assert.ok(typeof item.description === 'string' && item.description.length > 0)
    assert.ok(['easy', 'medium', 'hard'].includes(item.difficulty))
    assert.ok(typeof item.estimatedTime === 'string' && item.estimatedTime.length > 0)
  }

  // Test 2: Deteriorating trend triggers priority marker
  const deterioratingTrends = {
    outsideHoursPercentDiff: 6.2,
    unansweredQuestionsPercentDiff: 4.5,
  }
  const plan2 = generateActionPlan({ outsideHoursPercent: 32 }, deterioratingTrends)
  const outsideAction = plan2.find(item => item.id === 'action-outside-hours')
  assert.ok(outsideAction, 'Outside hours action must exist')
  assert.equal(outsideAction.isPriority, true, 'Action must be marked as priority')
  assert.ok(outsideAction.title.includes('⚠️ Приоритет'), 'Title must contain priority emoji')

  // Priority items should be sorted first
  assert.equal(plan2[0].isPriority, true)

  // Test 3: Healthy team gets productive proactive fallback steps (3-5 items)
  const healthyTeam = {
    outsideHoursPercent: 12,
    unansweredQuestionsPercent: 4,
    positivityIndex: 25,
    participationEvenness: 88,
    intensityIndex: 1,
  }
  const plan3 = generateActionPlan(healthyTeam)
  assert.ok(plan3.length >= 3 && plan3.length <= 5, 'Healthy team must also receive 3-5 items')
  assert.ok(plan3.every(item => item.id && item.title && item.description && item.difficulty && item.estimatedTime))

  // Test 4: Null/empty metrics still safely returns 3-5 fallback steps
  const planEmpty = generateActionPlan(null)
  assert.ok(planEmpty.length >= 3 && planEmpty.length <= 5)
})

test('analytics: calculateAchievements evaluates unlock conditions correctly', () => {
  // Empty metrics -> all achievements locked
  const empty = calculateAchievements({})
  assert.equal(empty.length, 6)
  assert.ok(empty.every(a => a.unlocked === false))
  assert.ok(empty.every(a => a.id && a.title && a.description && a.emoji))

  // Fully unlocked metrics
  const full = calculateAchievements({
    outsideHoursPercent: 10,
    participationEvenness: 90,
    positivityIndex: 25,
    recognitionPercent: 30,
    responseMedianMinutes: 15,
    unansweredQuestionsPercent: 2,
    intensityIndex: 0.5,
  })
  assert.equal(full.length, 6)
  assert.ok(full.every(a => a.unlocked === true))

  // Partial unlock test
  const partial = calculateAchievements({
    outsideHoursPercent: 35, // locked (> 20)
    participationEvenness: 85, // unlocked (> 80)
    positivityIndex: 5, // locked (<= 20)
    recognitionPercent: 25, // unlocked (> 20 -> gratitude_culture unlocked!)
    responseMedianMinutes: 45, // locked (>= 30)
    unansweredQuestionsPercent: 1, // unlocked (< 5)
    intensityIndex: 5, // locked (>= 2)
  })
  const map = Object.fromEntries(partial.map(a => [a.id, a.unlocked]))
  assert.equal(map.healthy_rhythm, false)
  assert.equal(map.balanced_team, true)
  assert.equal(map.gratitude_culture, true)
  assert.equal(map.fast_responders, false)
  assert.equal(map.no_unanswered, true)
  assert.equal(map.zen_communication, false)
})
