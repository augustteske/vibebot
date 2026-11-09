import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('CHANGELOG.md has a dated section for the package.json version used by the release workflow', async () => {
  const [changelog, pkg] = await Promise.all([
    readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
  ])
  const versions = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})\r?$/gm)].map(match => match[1])
  assert.equal(versions[0], pkg.version, 'верхняя версия в CHANGELOG.md должна совпадать с package.json')
  const heading = new RegExp(`^## \\[${pkg.version.replaceAll('.', '\\.')}\\]`, 'm')
  const section = changelog.split(heading)[1].split(/^## \[/m)[0]
  assert.match(section, /^- \S/m, 'секция версии должна содержать хотя бы один пункт')
})
