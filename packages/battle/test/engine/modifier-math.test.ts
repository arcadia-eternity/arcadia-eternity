import { expect, it } from 'vitest'
import { applyNumericModifier, evaluateEventMagnitude } from '../../src/engine/modifierMath'

it('compounds attribute percentages in priority order and pools event percentage points before flat changes', () => {
  expect(applyNumericModifier(applyNumericModifier(100, 'percent', 50), 'percent', -50)).toBe(75)
  expect(
    evaluateEventMagnitude(100, [
      { type: 'percent', value: 50 },
      { type: 'delta', value: 10 },
      { type: 'percent', value: -50 },
    ]),
  ).toBe(110)
})

it('selects the last base override and intersects event bounds with the ceiling winning conflicts', () => {
  expect(
    evaluateEventMagnitude(5, [
      { type: 'percent', value: 50 },
      { type: 'override', value: 10 },
      { type: 'override', value: 20 },
    ]),
  ).toBe(30)
  expect(
    evaluateEventMagnitude(10, [
      { type: 'clampMax', value: 20 },
      { type: 'clampMin', value: 30 },
      { type: 'clampMax', value: 25 },
    ]),
  ).toBe(20)
})

it('rejects invalid inputs and arithmetic overflow before any state is committed', () => {
  expect(() => evaluateEventMagnitude(NaN, [])).toThrow('Non-finite')
  expect(() => evaluateEventMagnitude(100, [{ type: 'clampMax', value: Infinity }])).toThrow('Non-finite')
  expect(() => evaluateEventMagnitude(Number.MAX_VALUE, [{ type: 'percent', value: 100 }])).toThrow('Non-finite')
})
