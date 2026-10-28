import { describe, expect, it } from 'vitest'
import type { AttributeModifierInfo, EntityModifierState } from '@arcadia-eternity/const'
import { getNumericAttributeModifier } from '../modifierStyles'

describe('getNumericAttributeModifier', () => {
  const numeric: AttributeModifierInfo<number> = {
    attributeName: 'currentHp',
    baseValue: 100,
    currentValue: 80,
    modifiers: [],
    isModified: true,
  }
  const state: EntityModifierState = { attributes: [numeric], hasModifiers: true }

  it('selects the original numeric metadata', () => {
    expect(getNumericAttributeModifier(state, 'currentHp')).toBe(numeric)
  })

  it('handles absent states and attributes', () => {
    expect(getNumericAttributeModifier(undefined, 'currentHp')).toBeUndefined()
    expect(getNumericAttributeModifier(state, 'rage')).toBeUndefined()
  })

  it.each([
    { baseValue: false, currentValue: 80 },
    { baseValue: 100, currentValue: true },
    { baseValue: '100', currentValue: 80 },
    { baseValue: 100, currentValue: '80' },
  ])('rejects nonnumeric metadata: %j', values => {
    const state: EntityModifierState = {
      attributes: [{ ...numeric, ...values }],
      hasModifiers: true,
    }
    expect(getNumericAttributeModifier(state, 'currentHp')).toBeUndefined()
  })
})
