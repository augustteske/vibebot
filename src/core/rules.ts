import type { DemoRound, Scores, Summary } from './model.ts'
export const MIN_PARTICIPANTS = 5
export const LOW_SCORE = 2
export const NEED_THRESHOLD = 0.4
const dimensions: (keyof Scores)[] = ['clarity', 'energy', 'support']

export function aggregateRound(round: DemoRound): Summary {
  if (!round.closed) return { status: 'open' }
  if (round.answers.length < MIN_PARTICIPANTS) return { status: 'insufficient' }
  for (const answer of round.answers) {
    for (const dimension of dimensions) {
      const value = answer[dimension]
      if (!Number.isInteger(value) || value < 1 || value > 5) throw new Error('Оценка должна быть целым числом от 1 до 5')
    }
  }
  const means: Scores = { energy: 0, clarity: 0, support: 0 }
  const needs: (keyof Scores)[] = []
  for (const dimension of dimensions) {
    means[dimension] = round.answers.reduce((sum, row) => sum + row[dimension], 0) / round.answers.length
    if (round.answers.filter(row => row[dimension] <= LOW_SCORE).length / round.answers.length >= NEED_THRESHOLD) needs.push(dimension)
  }
  return { status: 'published', means, needs }
}
