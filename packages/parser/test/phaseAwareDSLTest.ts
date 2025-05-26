/**
 * Test for phase-aware DSL and parser integration
 */

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

function testPhaseAwareDSLParsing() {
  console.log('=== Testing Phase-Aware DSL Parsing ===')

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
    try {
      console.log(`\n🧪 Testing: ${name}`)
      const effect = parseEffect(dsl)
      console.log(`✅ Successfully parsed effect: ${effect.id}`)
      console.log(`   - Trigger: ${effect.trigger}`)
      console.log(`   - Priority: ${effect.priority}`)
      console.log(`   - Actions: ${Array.isArray(effect.actions) ? effect.actions.length : 1}`)
    } catch (error) {
      console.error(`❌ Failed to parse ${name}:`, error.message)
    }
  })

  console.log('\n🎉 Phase-aware DSL parsing test completed!')
}

function testBackwardCompatibility() {
  console.log('\n=== Testing Backward Compatibility ===')

  // Test regular attribute modifier without phase parameters
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

  try {
    console.log('🧪 Testing: Regular Attribute Modifier (no phase params)')
    const effect = parseEffect(regularAttributeModifierEffect)
    console.log(`✅ Successfully parsed regular effect: ${effect.id}`)
    console.log('✅ Backward compatibility maintained!')
  } catch (error) {
    console.error('❌ Backward compatibility broken:', error.message)
  }
}

function runAllTests() {
  console.log('🚀 Starting Phase-Aware DSL and Parser Tests\n')

  testPhaseAwareDSLParsing()
  testBackwardCompatibility()

  console.log('\n🎉 All DSL and parser tests completed!')
}

export { runAllTests }

if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests()
}
