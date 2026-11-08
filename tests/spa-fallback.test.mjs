import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../server/app.mjs'

const secret = 'test-secret-used-only-in-automated-tests-123456789'

test('SPA fallback returns index.html for extensionless routes and 404 for missing assets or unknown API routes', async t => {
  const staticDir = await mkdtemp(join(tmpdir(), 'vibee-spa-static-'))
  t.after(async () => {
    await rm(staticDir, { recursive: true, force: true })
  })

  const html = '<!doctype html><html><body><div id="root">Vibee SPA</div></body></html>'
  await writeFile(join(staticDir, 'index.html'), html, 'utf8')
  await writeFile(join(staticDir, 'app.js'), 'console.log("ok")', 'utf8')

  const app = createApp({ secret, staticDir })
  await new Promise(resolveListen => app.server.listen(0, '127.0.0.1', resolveListen))
  t.after(() => app.close())
  const base = 'http://127.0.0.1:' + app.server.address().port

  const demoRes = await fetch(base + '/demo')
  assert.equal(demoRes.status, 200)
  assert.match(demoRes.headers.get('content-type') ?? '', /^text\/html/)
  assert.equal(await demoRes.text(), html)

  const assetRes = await fetch(base + '/app.js')
  assert.equal(assetRes.status, 200)
  assert.match(assetRes.headers.get('content-type') ?? '', /^text\/javascript/)

  const missingAssetRes = await fetch(base + '/missing.js')
  assert.equal(missingAssetRes.status, 404)
  assert.equal((await missingAssetRes.json()).error.code, 'NOT_FOUND')

  const apiRes = await fetch(base + '/api/nonexistent')
  assert.equal(apiRes.status, 404)
  assert.equal((await apiRes.json()).error.code, 'NOT_FOUND')
})
