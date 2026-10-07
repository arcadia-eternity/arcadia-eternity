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

    expect(executeActions?.selectorFields?.target?.allow).toEqual([{ kind: 'object', classes: ['dsl:operator'] }])
    expect(registerTaggedConfig?.valueFields?.tags?.allow).toEqual([
      { kind: 'scalar', valueTypes: ['string'] },
      { kind: 'object', classes: ['json:stringArray'] },
    ])
  })
})

describe('evaluator stringEnum typing', () => {
  test('anyOf evaluator has stringEnum constraint on value field', () => {
    const typing = getEffectDslNodeTyping('evaluator', 'anyOf')
    expect(typing).toBeDefined()
    expect(typing?.valueFields?.value).toBeDefined()

    const allow = typing!.valueFields!.value!.allow
    const stringEnum = allow.find(c => c.kind === 'stringEnum')
    expect(stringEnum).toBeDefined()
    expect(stringEnum!.values.length).toBeGreaterThan(0)
  })

  test('compare evaluator has stringEnum alongside original ANY_SELECTOR_RESULT constraints', () => {
    const typing = getEffectDslNodeTyping('evaluator', 'compare')
    expect(typing).toBeDefined()
    const allow = typing!.valueFields!.value!.allow

    const ids = allow.filter(c => c.kind === 'id')
    const scalars = allow.filter(c => c.kind === 'scalar')
    expect(ids.length).toBeGreaterThan(0)
    expect(scalars.length).toBeGreaterThan(0)

    const stringEnum = allow.find(c => c.kind === 'stringEnum')
    expect(stringEnum).toBeDefined()
    expect(stringEnum!.values.length).toBeGreaterThan(0)
  })

  test('same and notSame evaluators also have stringEnum constraint', () => {
    for (const type of ['same', 'notSame'] as const) {
      const typing = getEffectDslNodeTyping('evaluator', type)
      expect(typing).toBeDefined()
      const allow = typing!.valueFields!.value!.allow
      const stringEnum = allow.find(c => c.kind === 'stringEnum')
      expect(stringEnum).toBeDefined()
      expect(stringEnum!.values.length).toBeGreaterThan(0)
    }
  })

  test('stringEnum values are deduplicated (no duplicate values)', () => {
    const typing = getEffectDslNodeTyping('evaluator', 'anyOf')
    const stringEnum = typing!.valueFields!.value!.allow.find(c => c.kind === 'stringEnum')
    const values = stringEnum!.values.map(v => v.value)
    expect(new Set(values).size).toBe(values.length)
  })

  test('each stringEnum option has value and label fields', () => {
    const typing = getEffectDslNodeTyping('evaluator', 'anyOf')
    const stringEnum = typing!.valueFields!.value!.allow.find(c => c.kind === 'stringEnum')
    for (const opt of stringEnum!.values) {
      expect(typeof opt.value).toBe('string')
      expect(opt.value.length).toBeGreaterThan(0)
      expect(typeof opt.label).toBe('string')
      expect(opt.label.length).toBeGreaterThan(0)
    }
  })
})
