import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { createApp, resolveSecureCookies } from './app.mjs'
import { createRecommendationProvider } from './recommendation-provider.mjs'

const dataDir = resolve(process.env.VIBEBOT_DATA_DIR ?? '.data')
mkdirSync(dataDir, { recursive: true })
const telegramSynthetic = process.env.VIBEE_TELEGRAM_SYNTHETIC === 'true'
const telegramBootstrapCredential = process.env.VIBEE_TELEGRAM_BOOTSTRAP_CREDENTIAL
if (telegramSynthetic && process.env.NODE_ENV !== 'development') {
  throw new Error('The synthetic Telegram API requires NODE_ENV=development')
}
if (telegramSynthetic && !/^[a-f0-9]{64}$/.test(telegramBootstrapCredential ?? '')) {
  throw new Error('Synthetic Telegram mode requires a 64-character VIBEE_TELEGRAM_BOOTSTRAP_CREDENTIAL')
}
const recommendationProvider = createRecommendationProvider({
  provider: process.env.LLM_PROVIDER ?? 'template',
  apiKey: process.env.LLM_API_KEY,
  baseUrl: process.env.LLM_BASE_URL,
  model: process.env.LLM_MODEL,
})
const keyPath = resolve(dataDir, 'server.key')
let secret
try { secret = readFileSync(keyPath, 'utf8').trim() } catch (error) {
  if (error.code !== 'ENOENT') throw error
  secret = randomBytes(32).toString('hex')
  writeFileSync(keyPath, secret, { flag: 'wx', mode: 0o600 })
}
const app = createApp({
  dbPath: resolve(dataDir, 'vibebot.sqlite'), secret,
  staticDir: resolve('dist'),
  secureCookies: resolveSecureCookies(),
  allowedOrigins: (process.env.APP_ORIGIN ?? 'http://127.0.0.1:5173,http://localhost:5173')
    .split(',').map(origin => origin.trim()).filter(Boolean),
  telegramSynthetic,
  telegramBootstrapCredential,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  recommendationProvider,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI,
})
const host = process.env.HOST ?? '127.0.0.1'
const port = Number(process.env.PORT ?? 8787)
app.server.listen(port, host, () => console.log('Vibee: http://' + host + ':' + port))
let shuttingDown = false
const shutdown = () => { if (!shuttingDown) { shuttingDown = true; app.close().then(() => process.exit(0), () => process.exit(1)) } }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
