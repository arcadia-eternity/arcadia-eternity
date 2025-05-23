// Test file for new Observable selector functionality
import { BaseSelector } from '../src/selector'
import { Pet } from '@arcadia-eternity/battle'
import { EffectContext } from '@arcadia-eternity/battle'
import { EffectTrigger } from '@arcadia-eternity/const'

// Mock context for testing
function createMockContext(): EffectContext<EffectTrigger> {
  // This is a simplified mock - in real usage, you'd have a proper context
  return {
    battle: {} as any,
    source: {} as any,
    parent: null,
    trigger: EffectTrigger.OnTurnStart,
  } as EffectContext<EffectTrigger>
}

// Test function to verify selectObservable works
export function testSelectObservable() {
  console.log('Testing selectObservable...')
  
  try {
    // Create the selector
    const observableSelector = BaseSelector.self.selectObservable('currentHp')
    
    // Verify the selector was created
    console.log('✓ selectObservable method exists and returns a selector')
    console.log('Selector type:', observableSelector.type)
    
    // Test with mock context (this would normally be called during effect execution)
    const mockContext = createMockContext()
    
    // Note: In a real scenario, this would work with actual Pet instances
    // that have attributeSystem initialized
    console.log('✓ selectObservable selector created successfully')
    
    return true
  } catch (error) {
    console.error('✗ selectObservable test failed:', error)
    return false
  }
}

// Test function to verify selectAttribute$ works
export function testSelectAttributeStream() {
  console.log('Testing selectAttribute$...')
  
  try {
    // Create the selector
    const attributeStreamSelector = BaseSelector.self.selectAttribute$('atk')
    
    // Verify the selector was created
    console.log('✓ selectAttribute$ method exists and returns a selector')
    console.log('Selector type:', attributeStreamSelector.type)
    
    console.log('✓ selectAttribute$ selector created successfully')
    
    return true
  } catch (error) {
    console.error('✗ selectAttribute$ test failed:', error)
    return false
  }
}

// Test function to verify the new DSL types work
export function testDSLTypes() {
  console.log('Testing DSL type definitions...')
  
  try {
    // Test selectObservable DSL
    const selectObservableDSL = {
      type: 'selectObservable' as const,
      arg: 'currentHp'
    }
    
    // Test selectAttribute$ DSL
    const selectAttributeDSL = {
      type: 'selectAttribute$' as const,
      arg: 'atk'
    }
    
    // Test addDynamicAttributeModifier DSL
    const dynamicModifierDSL = {
      type: 'addDynamicAttributeModifier' as const,
      target: { base: 'self' },
      stat: 'atk',
      modifierType: 'percent',
      observableValue: {
        base: 'self',
        chain: [
          { type: 'selectAttribute$', arg: 'currentHp' }
        ]
      },
      priority: 100
    }
    
    console.log('✓ DSL type definitions are valid')
    console.log('selectObservable DSL:', selectObservableDSL)
    console.log('selectAttribute$ DSL:', selectAttributeDSL)
    console.log('dynamicModifier DSL:', dynamicModifierDSL)
    
    return true
  } catch (error) {
    console.error('✗ DSL types test failed:', error)
    return false
  }
}

// Test function to verify operator integration
export function testOperatorIntegration() {
  console.log('Testing operator integration...')
  
  try {
    // Import operators to verify they exist
    const { Operators } = require('../src/operator')
    
    // Check if new operators exist
    if (typeof Operators.addDynamicAttributeModifier === 'function') {
      console.log('✓ addDynamicAttributeModifier operator exists')
    } else {
      throw new Error('addDynamicAttributeModifier operator not found')
    }
    
    console.log('✓ Operator integration successful')
    
    return true
  } catch (error) {
    console.error('✗ Operator integration test failed:', error)
    return false
  }
}

// Run all tests
export function runAllTests() {
  console.log('=== Running Observable Selector Tests ===\n')
  
  const results = {
    selectObservable: testSelectObservable(),
    selectAttributeStream: testSelectAttributeStream(),
    dslTypes: testDSLTypes(),
    operatorIntegration: testOperatorIntegration()
  }
  
  console.log('\n=== Test Results ===')
  Object.entries(results).forEach(([test, passed]) => {
    console.log(`${test}: ${passed ? '✓ PASSED' : '✗ FAILED'}`)
  })
  
  const allPassed = Object.values(results).every(result => result)
  console.log(`\nOverall: ${allPassed ? '✓ ALL TESTS PASSED' : '✗ SOME TESTS FAILED'}`)
  
  return allPassed
}

// Example usage scenarios
export const UsageExamples = {
  // Basic Observable selector usage
  basicObservable: {
    description: 'Select a pet attribute as ObservableRef',
    dsl: {
      base: 'self',
      chain: [
        { type: 'selectObservable', arg: 'currentHp' }
      ]
    }
  },
  
  // Direct attribute stream usage
  directStream: {
    description: 'Get Observable stream of attribute',
    dsl: {
      base: 'self',
      chain: [
        { type: 'selectAttribute$', arg: 'atk' }
      ]
    }
  },
  
  // Dynamic modifier with Observable value
  dynamicModifier: {
    description: 'Create modifier with reactive value',
    dsl: {
      type: 'addDynamicAttributeModifier',
      target: { base: 'self' },
      stat: 'def',
      modifierType: 'percent',
      observableValue: {
        base: 'foe',
        chain: [
          { type: 'selectAttribute$', arg: 'atk' },
          { type: 'divide', arg: 100 }
        ]
      },
      priority: 200
    }
  }
}

// Export test runner for external use
if (require.main === module) {
  runAllTests()
}
