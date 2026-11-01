import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
let failed = false
function check(ok, message) { console.log((ok ? 'OK ' : 'FAIL ') + message); if (!ok) failed = true }
check(Number(process.versions.node.split('.')[0]) === 24, 'Node.js 24 (current: ' + process.version + ')')
check(existsSync('src/core/contracts.ts'), 'Run from the VibeBot repository root')
check(existsSync('node_modules/vite/bin/vite.js'), 'Dependencies installed with npm ci')
try {
  const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim()
  check(remote === 'https://gitlab.com/shertwg-group1/vibebot.git' || remote === 'git@gitlab.com:shertwg-group1/vibebot.git', 'origin points to team GitLab')
  console.log('Branch: ' + execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim())
} catch { check(false, 'Git repository and origin available') }
console.log('Start: npm run dev; interface 5173, server 8787. Stop with Ctrl+C.')
process.exitCode = failed ? 1 : 0
