import { describe, expect, test } from 'vitest'
import { getEffectDslManifest, getEffectDslNodeTyping } from '../src/effectDslManifest'

describe('effect dsl manifest', () => {
  test('includes known node types', () => {
    const manifest = getEffectDslManifest()
    expect(manifest.condition.evaluate).toBeDefined()
    expect(manifest.evaluator.probability).toBeDefined()
    expect(manifest.operator.dealDamage).toBeDefined()
    expect(manifest.operator.executeActions).toBeDefined()
  })

  test('exposes typed constraints for key nodes', () => {
    const executeActions = getEffectDslNodeTyping('operator', 'executeActions')
    const registerTaggedConfig = getEffectDslNodeTyping('operator', 'registerTaggedConfig')

    expect(executeActions?.selectorFields?.target?.allow).toEqual([
      { kind: 'object', classes: ['dsl:operator'] },
    ])
    expect(registerTaggedConfig?.valueFields?.tags?.allow).toEqual([
      { kind: 'scalar', valueTypes: ['string'] },
      { kind: 'object', classes: ['json:stringArray'] },
    ])
  })
})
