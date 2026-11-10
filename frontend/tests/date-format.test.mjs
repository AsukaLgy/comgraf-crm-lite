import test from 'node:test'
import assert from 'node:assert/strict'
import { formatDate, formatDateTime, dayKey } from '../src/api.js'

test('calendar dates keep the Honduras day without an implicit UTC conversion', () => {
  assert.match(formatDate('2026-11-09'), /09.*nov.*2026/i)
  assert.equal(dayKey('2026-11-09'), '2026-11-09')
  assert.doesNotMatch(formatDate('2026-11-09T23:30:00Z'), /:/)
})

test('activity timestamps retain the explicit hour', () => {
  assert.match(formatDateTime('2026-11-09T23:30:00Z'), /17:30|5:30/i)
})
