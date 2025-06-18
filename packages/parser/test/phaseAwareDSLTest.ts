/**
 * Test for phase-aware DSL and parser integration
 */

import { test, group } from '@japa/runner'
import { expect } from '@japa/expect'
import { parseEffect } from '../dist/index.js'
import type { EffectDSL } from '@arcadia-eternity/schema'

// Test 1: Phase-aware attribute modifier DSL
export const phaseAwareAttributeModifierEffect: EffectDSL = {
  id: 'phase_aware_attack_boost',
  trigger: 'OnTurnStart',
  priority: 100,
  apply: {
    type: 'addAttributeModifier',
    target: { base: 'self' },
    stat: { type: 'raw:string', value: 'attack' },
    modifierType: { type: 'raw:string', value: 'delta' },
    value: { type: 'raw:number', value: 50 },
    priority: { type: 'raw:number', value: 100 },
    // 🆕 Phase-aware parameters
    phaseType: { type: 'raw:string', value: 'skill' },
    scope: { type: 'raw:string', value: 'current' },
  },
}

// Test 2: Phase-aware dynamic attribute modifier DSL
export const phaseAwareDynamicAttributeModifierEffect: EffectDSL = {
  id: 'phase_aware_dynamic_defense_boost',
  trigger: 'OnTurnStart',
  priority: 100,
  apply: {
    type: 'addDynamicAttributeModifier',
    target: { base: 'self' },
    stat: { type: 'raw:string', value: 'defense' },
    modifierType: { type: 'raw:string', value: 'percent' },
    observableValue: {
      base: 'self',
      chain: [
        { type: 'selectAttribute$', arg: 'attack' },
        { type: 'multiply', arg: { type: 'raw:number', value: 0.5 } },
      ],
    },
    priority: { type: 'raw:number', value: 100 },
    // 🆕 Phase-aware parameters
    phaseType: { type: 'raw:string', value: 'damage' },
    scope: { type: 'raw:string', value: 'current' },
  },
}

// Test 3: Phase-aware clamp modifier DSL
export const phaseAwareClampModifierEffect: EffectDSL = {
  id: 'phase_aware_speed_clamp',
  trigger: 'OnTurnStart',
  priority: 100,
  apply: {
    type: 'addClampModifier',
    target: { base: 'self' },
    stat: { type: 'raw:string', value: 'speed' },
    minValue: { type: 'raw:number', value: 50 },
    maxValue: { type: 'raw:number', value: 200 },
    priority: { type: 'raw:number', value: 100 },
    // 🆕 Phase-aware parameters
    phaseType: { type: 'raw:string', value: 'turn' },
    scope: { type: 'raw:string', value: 'current' },
  },
}

// Test 4: Phase-aware skill attribute modifier DSL
export const phaseAwareSkillAttributeModifierEffect: EffectDSL = {
  id: 'phase_aware_skill_power_boost',
  trigger: 'OnTurnStart',
  priority: 100,
  apply: {
    type: 'addSkillAttributeModifier',
    target: {
      base: 'self',
      chain: [{ type: 'select', arg: 'skills' }],
    },
    attribute: { type: 'raw:string', value: 'power' },
    modifierType: { type: 'raw:string', value: 'delta' },
    value: { type: 'raw:number', value: 25 },
    priority: { type: 'raw:number', value: 100 },
    // 🆕 Phase-aware parameters
    phaseType: { type: 'raw:string', value: 'skill' },
    scope: { type: 'raw:string', value: 'current' },
  },
}

// Test 5: Specific phase ID modifier DSL
export const specificPhaseIdModifierEffect: EffectDSL = {
  id: 'fire_blast_specific_boost',
  trigger: 'OnTurnStart',
  priority: 100,
  apply: {
    type: 'addAttributeModifier',
    target: { base: 'self' },
    stat: { type: 'raw:string', value: 'attack' },
    modifierType: { type: 'raw:string', value: 'delta' },
    value: { type: 'raw:number', value: 100 },
    priority: { type: 'raw:number', value: 100 },
    // 🆕 Phase-aware parameters with specific phase ID
    phaseType: { type: 'raw:string', value: 'skill' },
    scope: { type: 'raw:string', value: 'current' },
    phaseId: { type: 'raw:string', value: 'fire_blast' },
  },
}

// Test 6: Min-only clamp modifier DSL
export const minOnlyClampModifierEffect: EffectDSL = {
  id: 'min_only_clamp_effect',
  trigger: 'OnTurnStart',
  priority: 100,
  apply: {
    type: 'addClampModifier',
    target: { base: 'self' },
    stat: { type: 'raw:string', value: 'defense' },
    minValue: { type: 'raw:number', value: 30 },
    // maxValue is omitted - min-only clamp
    priority: { type: 'raw:number', value: 100 },
    // 🆕 Phase-aware parameters
    phaseType: { type: 'raw:string', value: 'damage' },
    scope: { type: 'raw:string', value: 'current' },
  },
}

// Test 7: Max-only clamp modifier DSL
export const maxOnlyClampModifierEffect: EffectDSL = {
  id: 'max_only_clamp_effect',
  trigger: 'OnTurnStart',
  priority: 100,
  apply: {
    type: 'addClampModifier',
    target: { base: 'self' },
    stat: { type: 'raw:string', value: 'attack' },
    // minValue is omitted - max-only clamp
    maxValue: { type: 'raw:number', value: 999 },
    priority: { type: 'raw:number', value: 100 },
    // 🆕 Phase-aware parameters
    phaseType: { type: 'raw:string', value: 'skill' },
    scope: { type: 'raw:string', value: 'current' },
  },
}

group('Phase-Aware DSL Parsing', () => {
  const testCases = [
    { name: 'Phase-Aware Attribute Modifier', dsl: phaseAwareAttributeModifierEffect },
    { name: 'Phase-Aware Dynamic Attribute Modifier', dsl: phaseAwareDynamicAttributeModifierEffect },
    { name: 'Phase-Aware Clamp Modifier', dsl: phaseAwareClampModifierEffect },
    { name: 'Phase-Aware Skill Attribute Modifier', dsl: phaseAwareSkillAttributeModifierEffect },
    { name: 'Specific Phase ID Modifier', dsl: specificPhaseIdModifierEffect },
    { name: 'Min-Only Clamp Modifier', dsl: minOnlyClampModifierEffect },
    { name: 'Max-Only Clamp Modifier', dsl: maxOnlyClampModifierEffect },
  ]

  testCases.forEach(({ name, dsl }) => {
    test(`should parse ${name}`, () => {
      const effect = parseEffect(dsl)
      expect(effect.id).toBe(dsl.id)
      expect(effect.trigger).toBe(dsl.trigger)
      expect(effect.priority).toBe(dsl.priority)
      expect(effect.actions || effect.apply).toBeDefined()
    })
  })
})

group('Backward Compatibility', () => {
  test('should parse regular attribute modifier without phase parameters', () => {
    const regularAttributeModifierEffect: EffectDSL = {
      id: 'regular_attack_boost',
      trigger: 'OnTurnStart',
      priority: 100,
      apply: {
        type: 'addAttributeModifier',
        target: { base: 'self' },
        stat: { type: 'raw:string', value: 'attack' },
        modifierType: { type: 'raw:string', value: 'delta' },
        value: { type: 'raw:number', value: 30 },
        priority: { type: 'raw:number', value: 100 },
        // No phase parameters - should work as before
      },
    }

    const effect = parseEffect(regularAttributeModifierEffect)
    expect(effect.id).toBe('regular_attack_boost')
    expect(effect.trigger).toBe('OnTurnStart')
    expect(effect.priority).toBe(100)
  })
})
