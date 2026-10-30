export type Scores = { energy: number; clarity: number; support: number }
// Demo-only rows. Real clients must receive aggregates, never individual answers.
export type DemoRound = { closed: boolean; answers: Scores[] }
export type Summary =
  | { status: 'open' }
  | { status: 'insufficient' }
  | { status: 'published'; means: Scores; needs: (keyof Scores)[] }
export type InsightsProps = { summary: Summary }
export type ActionsProps = { summary: Summary }
