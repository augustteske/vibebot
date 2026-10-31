import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { createApp } from './app.mjs'

const dataDir = resolve(process.env.VIBEBOT_DATA_DIR ?? '.data')
mkdirSync(dataDir, { recursive: true })
const keyPath = resolve(dataDir, 'server.key')
let secret
try { secret = readFileSync(keyPath, 'utf8').trim() } catch (error) {
  if (error.code !== 'ENOENT') throw error
  secret = randomBytes(32).toString('hex')
  writeFileSync(keyPath, secret, { flag: 'wx', mode: 0o600 })
}
const app = createApp({
  dbPath: resolve(dataDir, 'vibebot.sqlite'), secret,
  staticDir: resolve('dist'), secureCookies: process.env.COOKIE_SECURE === 'true',
  allowedOrigins: (process.env.APP_ORIGIN ?? 'http://127.0.0.1:5173,http://localhost:5173').split(','),
})
const host = process.env.HOST ?? '127.0.0.1'
const port = Number(process.env.PORT ?? 8787)
app.server.listen(port, host, () => console.log('VibeBot: http://' + host + ':' + port))
let shuttingDown = false
const shutdown = () => { if (!shuttingDown) { shuttingDown = true; app.close().then(() => process.exit(0), () => process.exit(1)) } }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
