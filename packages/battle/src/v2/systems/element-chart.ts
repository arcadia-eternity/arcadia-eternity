// battle/src/systems/element-chart.ts
// Seer2 element chart — converts the existing ELEMENT_CHART to plugin-element format.

import { ELEMENT_CHART } from '@arcadia-eternity/const'
import { type ElementChart, buildElementChart } from '@arcadia-eternity/plugin-element'

/**
 * Build the Seer2 element chart from the const package's ELEMENT_CHART.
 */
export function createSeer2ElementChart(): ElementChart {
  const entries: Array<{ attack: string; defense: string; multiplier: number }> = []

  for (const [attackElement, defenseMap] of Object.entries(ELEMENT_CHART)) {
    for (const [defenseElement, multiplier] of Object.entries(defenseMap)) {
      entries.push({
        attack: attackElement,
        defense: defenseElement,
        multiplier,
      })
    }
  }

  return buildElementChart(entries)
}

/** Singleton instance of the Seer2 element chart */
let _chart: ElementChart | undefined

export function getSeer2ElementChart(): ElementChart {
  if (!_chart) {
    _chart = createSeer2ElementChart()
  }
  return _chart
}
