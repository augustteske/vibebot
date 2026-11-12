import { test } from 'node:test'
import assert from 'node:assert/strict'
import { teamTemperature } from '../server/team-health.mjs'

test('team temperature averages the three period metrics', () => {
  assert.equal(teamTemperature({
    outsideHoursPercent: 25,
    participationEvenness: 89.8,
    recognitionPercent: 20,
  }), 62)
})

test('team temperature turns outside-hours into warmth', () => {
  assert.equal(teamTemperature({
    outsideHoursPercent: 100,
    participationEvenness: 0,
    recognitionPercent: 0,
  }), 0)
  assert.equal(teamTemperature({
    outsideHoursPercent: 0,
    participationEvenness: 100,
    recognitionPercent: 100,
  }), 100)
})

test('team temperature rounds to a whole percent', () => {
  assert.equal(teamTemperature({
    outsideHoursPercent: 0,
    participationEvenness: 0,
    recognitionPercent: 1,
  }), 34)
  assert.equal(teamTemperature({
    outsideHoursPercent: 0,
    participationEvenness: 100,
    recognitionPercent: 0,
  }), 67)
})

test('team temperature rejects incomplete or out-of-range metrics', () => {
  assert.equal(teamTemperature(null), null)
  assert.equal(teamTemperature({}), null)
  assert.equal(teamTemperature({
    outsideHoursPercent: 25,
    participationEvenness: 89.8,
  }), null)
  assert.equal(teamTemperature({
    outsideHoursPercent: Number.NaN,
    participationEvenness: 50,
    recognitionPercent: 50,
  }), null)
  assert.equal(teamTemperature({
    outsideHoursPercent: 101,
    participationEvenness: 50,
    recognitionPercent: 50,
  }), null)
  assert.equal(teamTemperature({
    outsideHoursPercent: '25',
    participationEvenness: 50,
    recognitionPercent: 50,
  }), null)
})
