import test from 'node:test'
import assert from 'node:assert/strict'
import { promisedOrdersChartAxis } from '../src/calendar-chart.js'

test('calendar axis labels use the actual tick values for a short range', () => {
  assert.deepEqual(promisedOrdersChartAxis([0, 2, 4, 6]), {
    max: 6,
    ticks: [0, 2, 4, 6],
  })
})

test('calendar axis rounds larger counts without changing tick labels', () => {
  assert.deepEqual(promisedOrdersChartAxis([1, 8, 17]), {
    max: 20,
    ticks: [0, 5, 10, 15, 20],
  })
})
