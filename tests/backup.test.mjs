import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

function getBashCommand() {
  if (process.platform !== 'win32') {
    return 'bash'
  }
  const testPath = spawnSync('bash', ['--version'])
  if (testPath.status === 0) {
    return 'bash'
  }
  const candidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return 'bash'
}

test('backup script executes --host, clears sensitive tables, and verifies clean backup', async (t) => {
  const testDir = await mkdtemp(join(tmpdir(), 'vibee-backup-test-'))
  const dbPath = join(testDir, 'vibebot.sqlite')
  const backupDir = join(testDir, 'backups')
  const scriptPath = resolve('scripts/backup.sh')

  t.after(async () => {
    try {
      await rm(testDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors on tempdir
    }
  })

  // 1. Create a database with sensitive data and standard workspace data
  const db = new DatabaseSync(dbPath)
  try {
    db.exec(`
      CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, access_token TEXT, refresh_token TEXT);
      CREATE TABLE oauth_states (state TEXT PRIMARY KEY, created_at INTEGER);
      CREATE TABLE telegram_texts (id TEXT PRIMARY KEY, chat_id TEXT, text TEXT);
      CREATE TABLE telegram_media_observations (id TEXT PRIMARY KEY, chat_id TEXT, observation TEXT);

      INSERT INTO workspaces (id, name) VALUES ('ws-1', 'Engineering Team');
      INSERT INTO users (id, name, access_token, refresh_token) VALUES ('user-1', 'Alice', 'secret_token_123', 'secret_refresh_456');
      INSERT INTO oauth_states (state, created_at) VALUES ('state_xyz_789', 1700000000000);
      INSERT INTO telegram_texts (id, chat_id, text) VALUES ('msg-1', 'chat-100', 'Confidential chat message raw text');
      INSERT INTO telegram_media_observations (id, chat_id, observation) VALUES ('obs-1', 'chat-100', 'Voice recording raw transcription');
    `)
  } finally {
    db.close()
  }

  // 2. Execute bash scripts/backup.sh --host
  const bashCmd = getBashCommand()
  const result = spawnSync(bashCmd, [scriptPath, '--host'], {
    env: {
      ...process.env,
      VIBEE_DB_PATH: dbPath,
      VIBEE_BACKUP_DIR: backupDir,
    },
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, `backup.sh failed with status ${result.status}:\n${result.stderr || result.stdout}`)
  assert.match(result.stdout, /Vibee backup created:/)

  // 3. Inspect generated backup file
  assert.ok(existsSync(backupDir), 'backupDir should exist')
  const backupFiles = readdirSync(backupDir).filter(f => f.startsWith('vibebot_') && f.endsWith('.bak'))
  assert.equal(backupFiles.length, 1, `Expected exactly 1 backup file, found: ${backupFiles.join(', ')}`)

  const bakPath = join(backupDir, backupFiles[0])
  const bakDb = new DatabaseSync(bakPath)
  try {
    // telegram_texts must be empty
    const textCount = bakDb.prepare('SELECT COUNT(*) AS c FROM telegram_texts').get()
    assert.equal(textCount.c, 0, 'telegram_texts table should be purged')

    // telegram_media_observations must be empty
    const mediaCount = bakDb.prepare('SELECT COUNT(*) AS c FROM telegram_media_observations').get()
    assert.equal(mediaCount.c, 0, 'telegram_media_observations table should be purged')

    // oauth_states must be empty
    const oauthCount = bakDb.prepare('SELECT COUNT(*) AS c FROM oauth_states').get()
    assert.equal(oauthCount.c, 0, 'oauth_states table should be purged')

    // users access_token and refresh_token must be NULL
    const tokenCount = bakDb.prepare('SELECT COUNT(*) AS c FROM users WHERE access_token IS NOT NULL OR refresh_token IS NOT NULL').get()
    assert.equal(tokenCount.c, 0, 'tokens in users table must be NULL')

    // Normal workspace data and user identity should be preserved
    const wsRow = bakDb.prepare('SELECT id, name FROM workspaces WHERE id = ?').get('ws-1')
    assert.ok(wsRow, 'workspace should be preserved')
    assert.equal(wsRow.name, 'Engineering Team')

    const userRow = bakDb.prepare('SELECT id, name, access_token, refresh_token FROM users WHERE id = ?').get('user-1')
    assert.ok(userRow, 'user record should be preserved')
    assert.equal(userRow.name, 'Alice')
    assert.equal(userRow.access_token, null)
    assert.equal(userRow.refresh_token, null)
  } finally {
    bakDb.close()
  }
})
