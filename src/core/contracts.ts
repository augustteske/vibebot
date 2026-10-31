import type { Scores, Summary } from './model'

export type Suggestion = { id: string; title: string; body: string; reason: string; source: 'template' }
export type FeedbackSummary = { status: 'open' } | { status: 'insufficient' } | { status: 'published'; helpfulPercent: number }
export type TeamAction = { id: string; title: string; goal: string; createdAt: string; feedback: FeedbackSummary; myFeedbackSubmitted: boolean }
export type SessionSnapshot = {
  workspace: { id: string; name: string }
  member: { name: string; role: 'organizer' | 'participant' }
  round: { id: string; createdAt: string; closedAt: string | null; summary: Summary; mySubmitted: boolean }
  suggestions: Suggestion[]
  actions: TeamAction[]
  mode: 'templates'
}
export type CheckinInput = { roundId: string; scores: Scores }
