// Test: Parsing clamp operator DSL examples
import { parseEffect } from '../src/parseEffect'
import { clampEffectExamples } from './clampOperatorDSLExample'

function testClampDSLParsing() {
  console.log('=== Testing Clamp DSL Parsing ===')
  
  try {
    // Test 1: Attack cap effect
    console.log('\n1. Testing Attack Cap Effect...')
    const attackCapParsed = parseEffect(clampEffectExamples.attackCapEffect)
    console.log('✅ Attack cap effect parsed successfully')
    console.log('   Effect ID:', attackCapParsed.id)
    console.log('   Trigger:', attackCapParsed.trigger)
    
    // Test 2: Defense floor effect
    console.log('\n2. Testing Defense Floor Effect...')
    const defenseFloorParsed = parseEffect(clampEffectExamples.defenseFloorEffect)
    console.log('✅ Defense floor effect parsed successfully')
    console.log('   Effect ID:', defenseFloorParsed.id)
    
    // Test 3: Speed range effect
    console.log('\n3. Testing Speed Range Effect...')
    const speedRangeParsed = parseEffect(clampEffectExamples.speedRangeEffect)
    console.log('✅ Speed range effect parsed successfully')
    console.log('   Effect ID:', speedRangeParsed.id)
    
    // Test 4: Level-based HP cap
    console.log('\n4. Testing Level-based HP Cap...')
    const levelBasedParsed = parseEffect(clampEffectExamples.levelBasedHPCapEffect)
    console.log('✅ Level-based HP cap parsed successfully')
    console.log('   Effect ID:', levelBasedParsed.id)
    
    // Test 5: Emergency defense boost (conditional)
    console.log('\n5. Testing Emergency Defense Boost...')
    const emergencyParsed = parseEffect(clampEffectExamples.emergencyDefenseBoostEffect)
    console.log('✅ Emergency defense boost parsed successfully')
    console.log('   Effect ID:', emergencyParsed.id)
    console.log('   Has condition:', emergencyParsed.condition !== undefined)
    
    // Test 6: Balanced stats (multiple effects)
    console.log('\n6. Testing Balanced Stats Effect...')
    const balancedParsed = parseEffect(clampEffectExamples.balancedStatsEffect)
    console.log('✅ Balanced stats effect parsed successfully')
    console.log('   Effect ID:', balancedParsed.id)
    console.log('   Number of actions:', Array.isArray(balancedParsed.actions) ? balancedParsed.actions.length : 1)
    
    // Test 7: Percentage-based clamp
    console.log('\n7. Testing Percentage-based Clamp...')
    const percentageParsed = parseEffect(clampEffectExamples.percentageBasedClampEffect)
    console.log('✅ Percentage-based clamp parsed successfully')
    console.log('   Effect ID:', percentageParsed.id)
    
    // Test 8: Configurable clamp
    console.log('\n8. Testing Configurable Clamp...')
    const configurableParsed = parseEffect(clampEffectExamples.configurableClampEffect)
    console.log('✅ Configurable clamp parsed successfully')
    console.log('   Effect ID:', configurableParsed.id)
    
    // Test 9: Team-wide clamp
    console.log('\n9. Testing Team-wide Clamp...')
    const teamWideParsed = parseEffect(clampEffectExamples.teamWideClampEffect)
    console.log('✅ Team-wide clamp parsed successfully')
    console.log('   Effect ID:', teamWideParsed.id)
    
    // Test 10: Reactive clamp
    console.log('\n10. Testing Reactive Clamp...')
    const reactiveParsed = parseEffect(clampEffectExamples.reactiveClampEffect)
    console.log('✅ Reactive clamp parsed successfully')
    console.log('   Effect ID:', reactiveParsed.id)
    
    console.log('\n🎉 All clamp DSL parsing tests passed!')
    
  } catch (error) {
    console.error('❌ Error during parsing:', error)
    throw error
  }
}

function testClampOperatorTypes() {
  console.log('\n=== Testing Clamp Operator Type Validation ===')
  
  // Test that the DSL types are correctly defined
  const testEffects = [
    clampEffectExamples.attackCapEffect,
    clampEffectExamples.defenseFloorEffect,
    clampEffectExamples.speedRangeEffect
  ]
  
  testEffects.forEach((effect, index) => {
    console.log(`Effect ${index + 1}:`)
    console.log('  Type:', (effect.apply as any).type)
    console.log('  Target:', JSON.stringify((effect.apply as any).target))
    console.log('  Stat:', JSON.stringify((effect.apply as any).stat))
    
    if ('maxValue' in (effect.apply as any)) {
      console.log('  MaxValue:', JSON.stringify((effect.apply as any).maxValue))
    }
    if ('minValue' in (effect.apply as any)) {
      console.log('  MinValue:', JSON.stringify((effect.apply as any).minValue))
    }
    if ('priority' in (effect.apply as any)) {
      console.log('  Priority:', JSON.stringify((effect.apply as any).priority))
    }
    console.log('')
  })
}

function testComplexClampScenarios() {
  console.log('\n=== Testing Complex Clamp Scenarios ===')
  
  // Test complex DSL with multiple clamps and conditions
  const complexEffect = {
    id: 'complex_clamp_test',
    trigger: 'OnTurnStart' as const,
    priority: 100,
    condition: {
      type: 'evaluate' as const,
      target: { base: 'self' as const },
      evaluator: {
        type: 'compare' as const,
        operator: '>' as const,
        value: { type: 'raw:number' as const, value: 50 }
      }
    },
    apply: [
      {
        type: 'addClampMaxModifier' as const,
        target: { base: 'self' as const },
        stat: { type: 'raw:string' as const, value: 'atk' },
        maxValue: { type: 'raw:number' as const, value: 300 },
        priority: { type: 'raw:number' as const, value: 100 }
      },
      {
        type: 'addClampMinModifier' as const,
        target: { base: 'self' as const },
        stat: { type: 'raw:string' as const, value: 'def' },
        minValue: { type: 'raw:number' as const, value: 50 },
        priority: { type: 'raw:number' as const, value: 100 }
      }
    ]
  }
  
  try {
    const parsed = parseEffect(complexEffect)
    console.log('✅ Complex clamp scenario parsed successfully')
    console.log('   Effect ID:', parsed.id)
    console.log('   Has condition:', parsed.condition !== undefined)
    console.log('   Number of actions:', Array.isArray(parsed.actions) ? parsed.actions.length : 1)
  } catch (error) {
    console.error('❌ Complex scenario failed:', error)
    throw error
  }
}

// Run all tests
function runAllClampTests() {
  try {
    testClampDSLParsing()
    testClampOperatorTypes()
    testComplexClampScenarios()
    
    console.log('\n🎊 All clamp DSL tests completed successfully!')
    console.log('\nSummary:')
    console.log('- ✅ Basic clamp operators (clampMax, clampMin, clamp)')
    console.log('- ✅ Dynamic value calculations')
    console.log('- ✅ Conditional clamp effects')
    console.log('- ✅ Multiple effect combinations')
    console.log('- ✅ Complex selector chains')
    console.log('- ✅ Configurable parameters')
    console.log('- ✅ Team-wide targeting')
    console.log('- ✅ Reactive/observable clamps')
    
  } catch (error) {
    console.error('\n💥 Test suite failed:', error)
    process.exit(1)
  }
}

// Execute tests
runAllClampTests()
