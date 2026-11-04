import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

process.chdir(fileURLToPath(new URL('../', import.meta.url)))
if (existsSync('.env')) process.loadEnvFile('.env')
const config = JSON.parse(readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''))
const origin = new URL(config.origin)
if (origin.origin !== config.origin || !['http:', 'https:'].includes(origin.protocol)) {
  throw new Error('Use an exact HTTP/HTTPS origin without a path or trailing slash')
}
if (origin.protocol === 'http:' && config.origin !== `http://127.0.0.1:${config.port}`) {
  throw new Error('HTTP mode is restricted to the local loopback origin')
}
Object.assign(process.env, {
  HOST: '127.0.0.1', PORT: String(config.port), NODE_ENV: 'production',
  APP_ORIGIN: config.origin, COOKIE_SECURE: String(origin.protocol === 'https:'),
  VIBEE_TELEGRAM_SYNTHETIC: 'false', TELEGRAM_BOT_TOKEN: '', LLM_PROVIDER: 'template',
})
if (config.dataDir) process.env.VIBEBOT_DATA_DIR = resolve(config.dataDir)
await import('../server/index.mjs')
// A local file signal permits graceful shutdown on Windows without an HTTP admin endpoint.
const timer = setInterval(() => {
  if (!existsSync(config.stopFile)) return
  unlinkSync(config.stopFile)
  clearInterval(timer)
  process.emit('SIGTERM')
}, 250)
timer.unref()
