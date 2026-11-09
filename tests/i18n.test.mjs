import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  LANGUAGE_STORAGE_KEY,
  readLanguage,
  translations,
  localizedFeatures,
  localizedContrastPairs,
  localizedSteps,
} from '../src/core/i18n-data.ts'

test('i18n: storage key constant is defined', () => {
  assert.equal(LANGUAGE_STORAGE_KEY, 'vibee:lang')
})

test('i18n: default language fallback is ru in server/non-browser environment', () => {
  assert.equal(readLanguage(), 'ru')
})

test('i18n: structural parity between ru and en translations', () => {
  const ruKeys = Object.keys(translations.ru).sort()
  const enKeys = Object.keys(translations.en).sort()
  assert.deepEqual(ruKeys, enKeys, 'Both languages must have identical top-level sections')

  for (const section of ruKeys) {
    const ruSub = Object.keys(translations.ru[section]).sort()
    const enSub = Object.keys(translations.en[section]).sort()
    assert.deepEqual(ruSub, enSub, `Section "${section}" must have identical keys across ru and en`)
  }
})

test('i18n: localized features have matching numbers, icons, and non-empty texts', () => {
  assert.equal(localizedFeatures.ru.length, 3)
  assert.equal(localizedFeatures.en.length, 3)

  for (let i = 0; i < localizedFeatures.ru.length; i++) {
    const ru = localizedFeatures.ru[i]
    const en = localizedFeatures.en[i]
    assert.equal(ru.number, en.number)
    assert.equal(ru.icon, en.icon)
    assert.ok(ru.title.length > 0)
    assert.ok(en.title.length > 0)
    assert.ok(ru.description.length > 0)
    assert.ok(en.description.length > 0)
  }
})

test('i18n: localized contrast pairs have matching ids and all required fields', () => {
  assert.equal(localizedContrastPairs.ru.length, 3)
  assert.equal(localizedContrastPairs.en.length, 3)

  for (let i = 0; i < localizedContrastPairs.ru.length; i++) {
    const ru = localizedContrastPairs.ru[i]
    const en = localizedContrastPairs.en[i]
    assert.equal(ru.id, en.id)
    assert.ok(ru.beforeTitle && en.beforeTitle)
    assert.ok(ru.beforeText && en.beforeText)
    assert.ok(ru.beforeDetail && en.beforeDetail)
    assert.ok(ru.afterTitle && en.afterTitle)
    assert.ok(ru.afterText && en.afterText)
    assert.ok(ru.afterDetail && en.afterDetail)
  }
})

test('i18n: localized steps have matching numbers and non-empty labels and titles', () => {
  assert.equal(localizedSteps.ru.length, 4)
  assert.equal(localizedSteps.en.length, 4)

  for (let i = 0; i < localizedSteps.ru.length; i++) {
    const ru = localizedSteps.ru[i]
    const en = localizedSteps.en[i]
    assert.equal(ru.number, en.number)
    assert.ok(ru.label && en.label)
    assert.ok(ru.title && en.title)
    assert.ok(ru.description && en.description)
  }
})
