export function promisedOrdersChartAxis(dayCounts) {
  const chartMax = Math.max(1, ...dayCounts)
  const step = Math.max(1, Math.ceil(chartMax / 4))
  const max = Math.ceil(chartMax / step) * step
  const ticks = Array.from({ length: max / step + 1 }, (_, index) => index * step)
  return { max, ticks }
}
