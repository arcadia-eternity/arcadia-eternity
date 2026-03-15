// plugin-element/src/index.ts
// Generic element effectiveness chart.
// Provides a configurable type chart for any element-based game.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Element chart: attackElement → defenseElement → multiplier.
 * Missing entries default to 1.0 (neutral).
 */
export type ElementChart = Record<string, Record<string, number>>

// ---------------------------------------------------------------------------
// Core operations
// ---------------------------------------------------------------------------

/**
 * Create an empty element chart.
 */
export function createElementChart(): ElementChart {
  return {}
}

/**
 * Set effectiveness for a specific attack → defense pair.
 */
export function setEffectiveness(
  chart: ElementChart,
  attackElement: string,
  defenseElement: string,
  multiplier: number,
): void {
  if (!chart[attackElement]) {
    chart[attackElement] = {}
  }
  chart[attackElement][defenseElement] = multiplier
}

/**
 * Get effectiveness multiplier for an attack → defense pair.
 * Returns 1.0 if not defined.
 */
export function getEffectiveness(
  chart: ElementChart,
  attackElement: string,
  defenseElement: string,
): number {
  return chart[attackElement]?.[defenseElement] ?? 1.0
}

/**
 * Get effectiveness for an attack element against multiple defense elements.
 * Multiplies all individual effectiveness values.
 */
export function getMultiTypeEffectiveness(
  chart: ElementChart,
  attackElement: string,
  defenseElements: string[],
): number {
  let result = 1.0
  for (const def of defenseElements) {
    result *= getEffectiveness(chart, attackElement, def)
  }
  return result
}

/**
 * Check if an attack is super effective (> 1.0).
 */
export function isSuperEffective(
  chart: ElementChart,
  attackElement: string,
  defenseElement: string,
): boolean {
  return getEffectiveness(chart, attackElement, defenseElement) > 1.0
}

/**
 * Check if an attack is not very effective (< 1.0 and > 0).
 */
export function isNotVeryEffective(
  chart: ElementChart,
  attackElement: string,
  defenseElement: string,
): boolean {
  const eff = getEffectiveness(chart, attackElement, defenseElement)
  return eff < 1.0 && eff > 0
}

/**
 * Check if an attack has no effect (= 0).
 */
export function isImmune(
  chart: ElementChart,
  attackElement: string,
  defenseElement: string,
): boolean {
  return getEffectiveness(chart, attackElement, defenseElement) === 0
}

/**
 * Build an element chart from a flat array of entries.
 * Convenient for initialization.
 */
export function buildElementChart(
  entries: Array<{ attack: string; defense: string; multiplier: number }>,
): ElementChart {
  const chart = createElementChart()
  for (const entry of entries) {
    setEffectiveness(chart, entry.attack, entry.defense, entry.multiplier)
  }
  return chart
}

/**
 * Get all elements that an attack element is super effective against.
 */
export function getSuperEffectiveAgainst(
  chart: ElementChart,
  attackElement: string,
): string[] {
  const row = chart[attackElement]
  if (!row) return []
  return Object.entries(row)
    .filter(([, mult]) => mult > 1.0)
    .map(([elem]) => elem)
}

/**
 * Get all elements that resist an attack element.
 */
export function getResistances(
  chart: ElementChart,
  attackElement: string,
): string[] {
  const row = chart[attackElement]
  if (!row) return []
  return Object.entries(row)
    .filter(([, mult]) => mult < 1.0 && mult > 0)
    .map(([elem]) => elem)
}

/**
 * Get all elements that are immune to an attack element.
 */
export function getImmunities(
  chart: ElementChart,
  attackElement: string,
): string[] {
  const row = chart[attackElement]
  if (!row) return []
  return Object.entries(row)
    .filter(([, mult]) => mult === 0)
    .map(([elem]) => elem)
}
