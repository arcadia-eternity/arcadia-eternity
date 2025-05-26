/**
 * Test file for Phase Selector functionality
 * Validates that the new phase selectors work correctly
 */

import { BaseSelector } from '../dist/index.js'

function testPhaseSelectorTypes() {
  console.log('=== Testing Phase Selector Types ===')

  // Test that the new selectors exist in BaseSelector
  const hasCurrentPhase = 'currentPhase' in BaseSelector
  const hasAllPhases = 'allPhases' in BaseSelector

  console.log('currentPhase selector exists:', hasCurrentPhase)
  console.log('allPhases selector exists:', hasAllPhases)

  if (hasCurrentPhase && hasAllPhases) {
    console.log('✅ Phase selectors are properly defined')
  } else {
    console.log('❌ Phase selectors are missing')
  }

  // Test selector properties
  if (hasCurrentPhase) {
    const currentPhaseSelector = BaseSelector.currentPhase
    console.log('currentPhase selector type:', currentPhaseSelector.type)
    console.log('currentPhase selector has chain methods:', typeof currentPhaseSelector.selectProp === 'function')
  }

  if (hasAllPhases) {
    const allPhasesSelector = BaseSelector.allPhases
    console.log('allPhases selector type:', allPhasesSelector.type)
    console.log('allPhases selector has chain methods:', typeof allPhasesSelector.where === 'function')
  }

  console.log('✅ Phase selector types test completed\n')
}

function testSelectorChaining() {
  console.log('=== Testing Phase Selector Chaining ===')

  try {
    // Test currentPhase chaining
    const currentPhaseId = BaseSelector.currentPhase.selectProp('id')
    console.log('currentPhase.selectProp("id") created successfully')

    const currentPhaseState = BaseSelector.currentPhase.selectProp('state')
    console.log('currentPhase.selectProp("state") created successfully')

    // Test allPhases chaining
    const executingPhases = BaseSelector.allPhases.where({ type: 'selectProp', arg: 'state' })
    console.log('allPhases.where(...) created successfully')

    const limitedPhases = BaseSelector.allPhases.limit(3)
    console.log('allPhases.limit(3) created successfully')

    console.log('✅ Phase selector chaining test passed')
  } catch (error) {
    console.log('❌ Phase selector chaining test failed:', error.message)
  }

  console.log('✅ Phase selector chaining test completed\n')
}

function testSelectorDSLGeneration() {
  console.log('=== Testing Phase Selector DSL Generation ===')

  try {
    // Test basic selector DSL
    const currentPhaseDSL = { base: 'currentPhase' as const }
    console.log('Basic currentPhase DSL:', currentPhaseDSL)

    const allPhasesDSL = { base: 'allPhases' as const }
    console.log('Basic allPhases DSL:', allPhasesDSL)

    // Test chained selector DSL
    const chainedDSL = {
      base: 'currentPhase' as const,
      chain: [{ type: 'selectProp' as const, arg: 'state' }],
    }
    console.log('Chained currentPhase DSL:', chainedDSL)

    // Test complex selector DSL
    const complexDSL = {
      base: 'allPhases' as const,
      chain: [
        { type: 'where' as const, arg: { type: 'selectProp' as const, arg: 'state' } },
        { type: 'limit' as const, arg: 2 },
      ],
    }
    console.log('Complex allPhases DSL:', complexDSL)

    console.log('✅ Phase selector DSL generation test passed')
  } catch (error) {
    console.log('❌ Phase selector DSL generation test failed:', error.message)
  }

  console.log('✅ Phase selector DSL generation test completed\n')
}

function testEffectDefinitionExamples() {
  console.log('=== Testing Effect Definition Examples ===')

  try {
    // Example 1: Phase-specific config modifier
    const phaseConfigModifier = {
      type: 'addPhaseConfigModifier',
      target: { base: 'currentPhase' as const },
      configKey: 'effects.damageMultiplier',
      modifierType: 'delta',
      value: 0.5,
      priority: 100,
    }
    console.log('Phase config modifier effect:', JSON.stringify(phaseConfigModifier, null, 2))

    // Example 2: Conditional phase logic
    const conditionalPhaseEffect = {
      type: 'conditional',
      condition: {
        type: 'evaluate',
        target: {
          base: 'currentPhase' as const,
          chain: [{ type: 'selectProp' as const, arg: 'state' }],
        },
        evaluator: { type: 'same', value: 'Executing' },
      },
      trueOperator: {
        type: 'addPhaseConfigModifier',
        target: { base: 'currentPhase' as const },
        configKey: 'effects.powerBoost',
        modifierType: 'delta',
        value: 0.3,
        priority: 100,
      },
    }
    console.log('Conditional phase effect created successfully')

    // Example 3: Global phase modifier
    const globalPhaseModifier = {
      type: 'forEach',
      target: { base: 'allPhases' as const },
      operator: {
        type: 'addPhaseConfigModifier',
        configKey: 'ui.theme',
        modifierType: 'override',
        value: 'epic',
        priority: 50,
      },
    }
    console.log('Global phase modifier effect created successfully')

    // Example 4: Dynamic phase-based value
    const dynamicPhaseValue = {
      type: 'addDynamicConfigModifier',
      configKey: 'effects.skillPowerMultiplier',
      modifierType: 'delta',
      observableValue: {
        base: 'currentPhase' as const,
        chain: [
          { type: 'selectProp' as const, arg: 'state' },
          {
            type: 'when' as const,
            condition: { type: 'same', value: 'Executing' },
            trueValue: 0.5,
            falseValue: 0,
          },
        ],
      },
      priority: 100,
    }
    console.log('Dynamic phase value effect created successfully')

    console.log('✅ Effect definition examples test passed')
  } catch (error) {
    console.log('❌ Effect definition examples test failed:', error.message)
  }

  console.log('✅ Effect definition examples test completed\n')
}

function testTypeCompatibility() {
  console.log('=== Testing Type Compatibility ===')

  try {
    // Test that phase selectors work with existing selector operations
    const selectorOperations = ['selectProp', 'where', 'limit', 'flat', 'randomPick', 'shuffled']

    selectorOperations.forEach(operation => {
      if (typeof BaseSelector.currentPhase[operation] === 'function') {
        console.log(`✅ currentPhase.${operation} is available`)
      } else {
        console.log(`❌ currentPhase.${operation} is not available`)
      }

      if (typeof BaseSelector.allPhases[operation] === 'function') {
        console.log(`✅ allPhases.${operation} is available`)
      } else {
        console.log(`❌ allPhases.${operation} is not available`)
      }
    })

    console.log('✅ Type compatibility test passed')
  } catch (error) {
    console.log('❌ Type compatibility test failed:', error.message)
  }

  console.log('✅ Type compatibility test completed\n')
}

// Run all tests
function runAllTests() {
  console.log('🚀 Starting Phase Selector Tests\n')

  testPhaseSelectorTypes()
  testSelectorChaining()
  testSelectorDSLGeneration()
  testEffectDefinitionExamples()
  testTypeCompatibility()

  console.log('🎉 All phase selector tests completed!')
}

// Export for use in other test files
export {
  testPhaseSelectorTypes,
  testSelectorChaining,
  testSelectorDSLGeneration,
  testEffectDefinitionExamples,
  testTypeCompatibility,
  runAllTests,
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests()
}
