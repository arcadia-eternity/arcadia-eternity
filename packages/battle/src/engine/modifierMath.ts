/** The arithmetic operand has already been read in the caller's evaluation context. */
export type NumericModifierOperation = 'percent' | 'delta' | 'override' | 'clampMin' | 'clampMax'

export interface NumericModifierTerm {
  readonly type: NumericModifierOperation
  readonly value: number
}

export function applyNumericModifier(base: number, type: NumericModifierOperation, value: number): number {
  switch (type) {
    case 'percent':
      return base * (1 + value / 100)
    case 'delta':
      return base + value
    case 'override':
      return value
    case 'clampMin':
      return Math.max(base, value)
    case 'clampMax':
      return Math.min(base, value)
  }
}

/**
 * Event percentage points share one layer, followed by flat adjustments and bounds.
 * Terms arrive in declaration order. The last override supplies the base. All
 * bounds constrain the result, with the upper bound winning a conflicting floor.
 */
export function evaluateEventMagnitude(base: number, modifiers: readonly NumericModifierTerm[]): number {
  if (!Number.isFinite(base)) throw new Error('Non-finite event magnitude')
  let percent = 0
  let delta = 0
  let lower = -Infinity
  let upper = Infinity
  for (const { type, value } of modifiers) {
    if (!Number.isFinite(value)) throw new Error('Non-finite event modifier')
    switch (type) {
      case 'percent':
        percent += value
        break
      case 'delta':
        delta += value
        break
      case 'override':
        base = value
        break
      case 'clampMin':
        lower = Math.max(lower, value)
        break
      case 'clampMax':
        upper = Math.min(upper, value)
        break
    }
  }
  const scaled = applyNumericModifier(base, 'percent', percent)
  const adjusted = applyNumericModifier(scaled, 'delta', delta)
  if (!Number.isFinite(adjusted)) throw new Error('Non-finite event magnitude')
  return Math.min(upper, Math.max(lower, adjusted))
}
