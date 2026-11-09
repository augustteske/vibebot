import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  renderShareCardPng, SHARE_CARD_HEIGHT, SHARE_CARD_WIDTH,
} from '../server/share-card.mjs'

const metrics = {
  outsideHoursPercent: 25,
  participationEvenness: 89.8,
  recognitionPercent: 20,
}

test('share card: renders a valid PNG of the documented size', () => {
  const png = renderShareCardPng({ metrics, demo: true })
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG')
  assert.equal(png.readUInt32BE(16), SHARE_CARD_WIDTH)
  assert.equal(png.readUInt32BE(20), SHARE_CARD_HEIGHT)
  assert.equal(png[24], 8) // bit depth
  assert.equal(png[25], 6) // RGBA
  assert.ok(png.length > 1024)
})

test('share card: metrics change the image', () => {
  const first = renderShareCardPng({ metrics })
  const second = renderShareCardPng({ metrics: { ...metrics, participationEvenness: 12.5 } })
  assert.equal(first.equals(second), false)
  assert.equal(first.equals(renderShareCardPng({ metrics })), true)
})

test('share card: missing metrics still render a card', () => {
  const png = renderShareCardPng({})
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG')
  assert.equal(png.readUInt32BE(16), SHARE_CARD_WIDTH)
})
