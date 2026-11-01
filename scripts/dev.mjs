import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
const children = []
let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill()
  process.exitCode = code
}
for (const args of [['--watch', 'server/index.mjs'], [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--strictPort']]) {
  const child = spawn(process.execPath, args, { stdio: 'inherit', windowsHide: true })
  children.push(child)
  child.on('error', () => stop(1))
  child.on('exit', code => stop(code ?? 0))
}
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
