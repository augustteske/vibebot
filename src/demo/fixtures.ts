import type { DemoRound, Scores } from '../core/model'
const answers: Scores[] = [
  { energy: 4, clarity: 1, support: 4 },
  { energy: 4, clarity: 2, support: 4 },
  { energy: 3, clarity: 2, support: 5 },
  { energy: 4, clarity: 4, support: 3 },
  { energy: 5, clarity: 4, support: 4 },
  { energy: 4, clarity: 3, support: 4 },
]
export const demoRounds = {
  clarity: { closed: true, answers },
  small: { closed: true, answers: answers.slice(0, 4) },
  open: { closed: false, answers },
} satisfies Record<string, DemoRound>
