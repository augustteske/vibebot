import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { drawText, loadFontFile, measureText, rasterizeText } from '../server/truetype.mjs'

const fonts = join(dirname(fileURLToPath(import.meta.url)), '..', 'server', 'fonts')
const font = loadFontFile(join(fonts, 'inter-semibold.ttf'))
const bold = loadFontFile(join(fonts, 'inter-extrabold.ttf'))

test('truetype: шрифт читается и знает высоту заглавных', () => {
  assert.ok(font.unitsPerEm >= 1000)
  assert.ok(font.capHeight > font.unitsPerEm * 0.6 && font.capHeight < font.unitsPerEm * 0.8)
  assert.equal(font.glyphFor('А'.codePointAt(0)), font.glyphFor('А'.codePointAt(0)))
  assert.notEqual(font.glyphFor('А'.codePointAt(0)), font.glyphFor('A'.codePointAt(0)))
})

test('truetype: ширина строки пропорциональна буквам', () => {
  const size = 100
  assert.ok(measureText(font, 'WWW', size) > measureText(font, 'iii', size) * 2)
  assert.ok(measureText(font, 'ПУЛЬС', size) > 100)
  assert.ok(measureText(bold, '89,8%', size) < 100 * 4)
})

test('truetype: глиф растеризуется со сглаживанием', () => {
  const mask = rasterizeText(font, 'Пульс', 64)
  assert.ok(mask.width > 0 && mask.height > 0)
  assert.equal(mask.coverage.length, mask.width * mask.height)
  const covered = mask.coverage.filter((value) => value > 0)
  assert.ok(covered.length > 0)
  assert.ok(covered.every((value) => value > 0 && value <= 1))
  assert.ok(covered.some((value) => value > 0.05 && value < 0.95), 'есть полупрозрачные пиксели')
})

test('truetype: составной глиф «Й» отличается от «И»', () => {
  const plain = rasterizeText(font, 'И', 64)
  const composite = rasterizeText(font, 'Й', 64)
  assert.ok(composite.height > plain.height)
  assert.ok(composite.coverage.filter((value) => value > 0).length > plain.coverage.filter((value) => value > 0).length)
})

test('truetype: текст ложится на картинку', () => {
  const image = {
    pixels: new Uint8Array(40 * 20 * 4),
    blend(x, y, alpha, color) {
      if (x < 0 || y < 0 || x >= 40 || y >= 20) return
      const offset = (y * 40 + x) * 4
      for (let channel = 0; channel < 3; channel++) {
        this.pixels[offset + channel] = Math.round(color[channel] * alpha + this.pixels[offset + channel] * (1 - alpha))
      }
    },
  }
  drawText(image, font, 'V', { x: 4, baseline: 16, size: 20, color: [255, 0, 0] })
  assert.ok(image.pixels.some((value, index) => index % 4 !== 3 && value > 0))
})
