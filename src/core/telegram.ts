// Telegram v1: additive contracts; existing check-in contracts stay unchanged.
export type ConsentPhase = 'disconnected' | 'awaiting_consents' | 'active' | 'paused'
export type ConsentDecision = 'accepted' | 'declined' | 'withdrawn'
export type ConsentState = {
  phase: ConsentPhase
  revision: number
  policyVersion: string
  rosterVersion: number
  roster: string[]
  rosterVerified: boolean
  companyAccepted: boolean
  decisions: Record<string, ConsentDecision>
}
export type ConsentEvent =
  | { type: 'bind'; policyVersion: string }
  | { type: 'roster'; members: string[] }
  | { type: 'company'; accepted: boolean }
  | { type: 'decision'; memberId: string; decision: ConsentDecision }
  | { type: 'policy'; policyVersion: string }
  | { type: 'pause' | 'unknown_member' | 'resume' | 'disconnect' }

export const initialConsentState = (): ConsentState => ({
  phase: 'disconnected', revision: 0, policyVersion: '', rosterVersion: 0,
  roster: [], rosterVerified: false, companyAccepted: false, decisions: {},
})

// Called only after authorization and runtime schema validation by the server.
// Revision checking and persistence must be one transaction. No I/O or text here.
export function transitionConsent(state: ConsentState, event: ConsentEvent, expectedRevision: number): ConsentState {
  if (expectedRevision !== state.revision) throw new Error('STALE_REVISION')
  const next = structuredClone(state)
  next.revision++
  if (event.type === 'disconnect') return { ...initialConsentState(), revision: next.revision }
  if (event.type === 'bind') {
    if (state.phase !== 'disconnected' || !event.policyVersion.trim()) throw new Error('INVALID_TRANSITION')
    return { ...next, phase: 'awaiting_consents', policyVersion: event.policyVersion }
  }
  if (state.phase === 'disconnected') throw new Error('INVALID_TRANSITION')
  switch (event.type) {
    case 'roster':
      if (!event.members.length || event.members.some(id => !id.trim()) || new Set(event.members).size !== event.members.length) throw new Error('INVALID_ROSTER')
      next.roster = [...event.members]
      next.rosterVerified = true
      next.rosterVersion++
      next.decisions = {}
      next.phase = 'paused'
      break
    case 'company':
      next.companyAccepted = event.accepted
      if (!event.accepted) next.phase = 'paused'
      break
    case 'decision':
      if (!next.rosterVerified || !next.roster.includes(event.memberId)) throw new Error('UNKNOWN_MEMBER')
      next.decisions[event.memberId] = event.decision
      if (event.decision !== 'accepted') next.phase = 'paused'
      break
    case 'policy':
      if (!event.policyVersion.trim() || event.policyVersion === state.policyVersion) throw new Error('INVALID_POLICY')
      next.policyVersion = event.policyVersion
      next.companyAccepted = false
      next.decisions = {}
      next.phase = 'paused'
      break
    case 'unknown_member':
      next.rosterVerified = false
      next.decisions = {}
      next.phase = 'paused'
      break
    case 'pause':
      next.phase = 'paused'
      break
    case 'resume':
      if (!allConsented(next)) throw new Error('CONSENT_REQUIRED')
      next.phase = 'active'
      break
    default:
      throw new Error('INVALID_EVENT')
  }
  return next
}

function allConsented(state: ConsentState): boolean {
  return state.rosterVerified && state.companyAccepted && state.roster.length > 0
    && state.roster.every(id => state.decisions[id] === 'accepted')
}
export function canProcessChat(state: ConsentState): boolean {
  return state.phase === 'active' && allConsented(state)
}

export type TelegramTextEvent = {
  eventId: string
  expectedRevision: number
  chatId: string
  messageId: string
  senderId: string
  sentAt: string
  text: string
}
export type CommunicationView =
  | { status: 'disconnected' | 'awaiting_consents' | 'paused' | 'calibrating' | 'open' | 'insufficient' | 'error' }
  | { status: 'published'; period: { id: string; start: string; end: string };
      dataSource: 'chat'; profileVersion: number;
      metrics: { outsideHoursPercent: number; participationEvenness: number; recognitionPercent: number };
      recognitionMethod: 'lexicon-v1'; comparison: null; demo?: boolean }
export type CommunicationRecommendation = {
  id: string; periodId: string; profileVersion: number; dataSource: 'chat'; source: 'ai' | 'template'
  observation: string; explanation: string; limitation: string; action: string
}
