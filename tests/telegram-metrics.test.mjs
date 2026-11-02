import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateOutsideHoursPercent,
  calculateParticipationEvenness,
  calculateRecognitionPercent,
} from '../server/telegram-store.mjs'

test('outside-hours percentage is rounded to one decimal place', () => {
  assert.equal(calculateOutsideHoursPercent(3, 10), 30)
  assert.equal(calculateOutsideHoursPercent(1, 6), 16.7)
  assert.equal(calculateOutsideHoursPercent(0, 10), 0)
})

test('participation evenness includes silent members in the normalization', () => {
  assert.equal(calculateParticipationEvenness([4, 4, 4, 4, 4], 6, 20), 89.8)
  assert.equal(calculateParticipationEvenness([1, 1, 1, 1, 1, 1], 6, 6), 100)
  assert.equal(calculateParticipationEvenness([20], 6, 20), 0)
})

test('recognition percentage uses the recognized-message count', () => {
  assert.equal(calculateRecognitionPercent(2, 10), 20)
  assert.equal(calculateRecognitionPercent(1, 6), 16.7)
  assert.equal(calculateRecognitionPercent(0, 10), 0)
})

test('metric calculators reject invalid denominators and inconsistent counts', () => {
  assert.throws(() => calculateOutsideHoursPercent(0, 0), RangeError)
  assert.throws(() => calculateOutsideHoursPercent(11, 10), RangeError)
  assert.throws(() => calculateParticipationEvenness([4, 4], 3, 10), RangeError)
  assert.throws(() => calculateParticipationEvenness([4, 4], 1, 8), RangeError)
  assert.throws(() => calculateRecognitionPercent(-1, 10), RangeError)
})
