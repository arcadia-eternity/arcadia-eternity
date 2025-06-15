import { describe, it, expect } from 'vitest'
import { effectDSLSchema } from '../src/effectSchema'
import type { EffectDSL, SelectorValue } from '../src/effectDsl'

describe('SelectorValue Syntax', () => {
  it('should validate basic SelectorValue', () => {
    const selectorValue: SelectorValue = {
      type: 'selector',
      value: 100,
      chain: [
        { type: 'add', arg: 50 }
      ]
    }

    expect(() => effectDSLSchema.parse({
      id: 'test_selector_value',
      trigger: 'OnTurnStart',
      priority: 100,
      apply: {
        type: 'dealDamage',
        target: selectorValue,
        value: 50
      }
    })).not.toThrow()
  })

  it('should validate SelectorValue with array', () => {
    const effect: EffectDSL = {
      id: 'array_selector_test',
      trigger: 'OnTurnStart',
      priority: 100,
      apply: {
        type: 'heal',
        target: 'self',
        value: {
          type: 'selector',
          value: [10, 20, 30],
          chain: [
            { type: 'randomPick', arg: 1 }
          ]
        }
      }
    }

    expect(() => effectDSLSchema.parse(effect)).not.toThrow()
  })

  it('should validate SelectorValue with dynamic value', () => {
    const effect: EffectDSL = {
      id: 'dynamic_selector_test',
      trigger: 'OnDealDamage',
      priority: 100,
      apply: {
        type: 'dealDamage',
        target: 'target',
        value: {
          type: 'selector',
          value: {
            type: 'dynamic',
            selector: {
              base: 'self',
              chain: [{ type: 'selectPath', arg: 'currentHp' }]
            }
          },
          chain: [
            { type: 'divide', arg: 10 },
            { type: 'clampMax', arg: 100 }
          ]
        }
      }
    }

    expect(() => effectDSLSchema.parse(effect)).not.toThrow()
  })

  it('should validate SelectorValue with conditional value', () => {
    const effect: EffectDSL = {
      id: 'conditional_selector_test',
      trigger: 'OnTurnStart',
      priority: 100,
      apply: {
        type: 'addAttributeModifier',
        target: 'self',
        stat: 'atk',
        modifierType: 'percent',
        value: {
          type: 'selector',
          value: {
            type: 'conditional',
            condition: {
              type: 'evaluate',
              target: 'self',
              evaluator: {
                type: 'compare',
                operator: '<',
                value: 50
              }
            },
            trueValue: 30,
            falseValue: 10
          }
        }
      }
    }

    expect(() => effectDSLSchema.parse(effect)).not.toThrow()
  })

  it('should validate SelectorValue with config value', () => {
    const effect: EffectDSL = {
      id: 'config_selector_test',
      trigger: 'OnTurnStart',
      priority: 100,
      apply: {
        type: 'dealDamage',
        target: 'target',
        value: {
          type: 'selector',
          value: {
            type: 'raw:number',
            value: 75,
            configId: 'base_damage',
            tags: ['damage']
          },
          chain: [
            { type: 'multiply', arg: 1.5 }
          ]
        }
      }
    }

    expect(() => effectDSLSchema.parse(effect)).not.toThrow()
  })

  it('should validate complex SelectorValue with multiple operations', () => {
    const effect: EffectDSL = {
      id: 'complex_selector_test',
      trigger: 'OnDealDamage',
      priority: 100,
      apply: {
        type: 'dealDamage',
        target: 'target',
        value: {
          type: 'selector',
          value: [
            {
              type: 'dynamic',
              selector: {
                base: 'self',
                chain: [{ type: 'selectPath', arg: 'stat.atk' }]
              }
            },
            50
          ],
          chain: [
            { type: 'sum' },
            { type: 'multiply', arg: 1.2 },
            { type: 'clampMin', arg: 10 },
            { type: 'clampMax', arg: 200 }
          ]
        }
      }
    }

    expect(() => effectDSLSchema.parse(effect)).not.toThrow()
  })
})
