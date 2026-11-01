import { spawnSync } from 'node:child_process'
for (const args of [['--test', 'tests/*.test.mjs'], ['node_modules/typescript/bin/tsc', '-b'], ['node_modules/vite/bin/vite.js', 'build']]) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', windowsHide: true })
  if (result.error) { console.error(result.error.message); process.exit(1) }
  if (result.status !== 0) process.exit(result.status ?? 1)
}
