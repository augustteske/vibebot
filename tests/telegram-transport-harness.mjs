// Local synthetic API fixture for Python HTTP transport tests. No Telegram network calls.
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createApp } from '../server/app.mjs'
import { createStore } from '../server/store.mjs'
import { initialConsentState, transitionConsent } from '../src/core/telegram.ts'

const dir = await mkdtemp(join(tmpdir(), 'vibee-transport-'))
const dbPath = join(dir, 'test.sqlite')
const secret = 'synthetic-transport-test-secret-32-bytes-minimum'
const credential = '5'.repeat(64)
const chatId = '-100000000007'
const store = createStore({ path: dbPath, secret })
const ownerToken = store.createWorkspace({ name: 'Transport test', displayName: 'Owner' })
const owner = store.authenticate(ownerToken)
const people = [owner]
for (let i = 1; i < 5; i++) {
  people.push(store.authenticate(store.join({ token: store.invite(owner).token, displayName: 'Member ' + i })))
}
store.close()

const db = new DatabaseSync(dbPath)
db.exec('PRAGMA foreign_keys=ON')
const bindingId = randomUUID()
let state = initialConsentState()
const apply = event => { state = transitionConsent(state, event, state.revision) }
apply({ type: 'bind', policyVersion: 'synthetic-v1' })
apply({ type: 'roster', members: people.map(person => person.id) })
apply({ type: 'company', accepted: true })
for (const person of people) apply({ type: 'decision', memberId: person.id, decision: 'accepted' })
apply({ type: 'resume' })
db.prepare('INSERT INTO telegram_bindings(id,workspace_id,chat_id,state) VALUES(?,?,?,?)')
  .run(bindingId, owner.workspace_id, chatId, JSON.stringify(state))
for (let i = 0; i < people.length; i++) {
  db.prepare('INSERT INTO telegram_links VALUES(?,?,?,?)').run(bindingId, owner.workspace_id, people[i].id, String(300000001 + i))
}
db.prepare('INSERT INTO telegram_credentials(token_hash,workspace_id,binding_id) VALUES(?,?,?)')
  .run(createHash('sha256').update(credential).digest('hex'), owner.workspace_id, bindingId)
db.prepare('INSERT INTO telegram_profiles VALUES(?,?,?,?)')
  .run(owner.workspace_id, 1, 'UTC', JSON.stringify([1, 2, 3, 4, 5, 6, 7].map(day => ({ day, start: 0, end: 1440 }))))
db.close()

const app = createApp({ dbPath, secret, telegramSynthetic: true })
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve))
process.stdout.write(JSON.stringify({ baseUrl: 'http://127.0.0.1:' + app.server.address().port,
  dbPath, bindingId, credential, chatId, ownerToken, revision: state.revision }) + '\n')

let closing = false
const close = async () => {
  if (closing) return
  closing = true
  await app.close()
  await rm(dir, { recursive: true, force: true })
  process.exit(0)
}
process.on('SIGTERM', () => { close().catch(() => process.exit(1)) })
process.on('SIGINT', () => { close().catch(() => process.exit(1)) })
