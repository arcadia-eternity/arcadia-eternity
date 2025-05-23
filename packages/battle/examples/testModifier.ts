// Test file to verify Modifier functionality
import { Modifier, DurationType, computed, ref } from '../src/attributeSystem'

function testBasicModifier() {
  console.log('=== Testing Basic Modifier ===')
  
  try {
    // Test with static value
    const modifier = new Modifier(
      DurationType.binding,
      'test_modifier',
      10,
      'delta',
      100
    )
    
    console.log('Modifier created successfully')
    console.log('Current value:', modifier.getCurrentValue()) // Should be 10
    
    const baseValue = 100
    const result = modifier.apply(baseValue)
    console.log(`Base: ${baseValue}, Modified: ${result}`) // Should be 110
    
    if (result === 110) {
      console.log('✅ Basic modifier test PASSED')
    } else {
      console.log('❌ Basic modifier test FAILED')
    }
  } catch (error) {
    console.error('❌ Basic modifier test FAILED with error:', error)
  }
}

function testComputedModifier() {
  console.log('\n=== Testing Computed Modifier ===')
  
  try {
    // Create reactive refs
    const level = ref(1)
    const basePower = ref(50)
    
    // Create computed value
    const finalPower = computed(
      () => basePower.value + level.value * 5,
      [level, basePower]
    )
    
    console.log('Computed created successfully')
    
    // Create modifier with computed value
    const modifier = new Modifier(
      DurationType.binding,
      'computed_modifier',
      finalPower,
      'override',
      100
    )
    
    console.log('Modifier with computed created successfully')
    console.log('Initial computed value:', modifier.getCurrentValue()) // Should be 55 (50 + 1*5)
    
    const baseValue = 100
    let result = modifier.apply(baseValue)
    console.log(`Base: ${baseValue}, Modified: ${result}`) // Should be 55
    
    if (result === 55) {
      console.log('✅ Initial computed modifier test PASSED')
    } else {
      console.log('❌ Initial computed modifier test FAILED')
      return
    }
    
    // Update level and test reactivity
    console.log('\nUpdating level from 1 to 3...')
    level.next(3)
    
    // Give a moment for the computed to update
    setTimeout(() => {
      const newValue = modifier.getCurrentValue()
      console.log('New computed value:', newValue) // Should be 65 (50 + 3*5)
      
      const newResult = modifier.apply(baseValue)
      console.log(`Base: ${baseValue}, New Modified: ${newResult}`) // Should be 65
      
      if (newResult === 65) {
        console.log('✅ Reactive computed modifier test PASSED')
      } else {
        console.log('❌ Reactive computed modifier test FAILED')
      }
    }, 10)
    
  } catch (error) {
    console.error('❌ Computed modifier test FAILED with error:', error)
  }
}

function testRefModifier() {
  console.log('\n=== Testing Ref Modifier ===')
  
  try {
    // Create a ref
    const valueRef = ref(20)
    
    // Create modifier with ref
    const modifier = new Modifier(
      DurationType.binding,
      'ref_modifier',
      valueRef,
      'delta',
      100
    )
    
    console.log('Modifier with ref created successfully')
    console.log('Initial ref value:', modifier.getCurrentValue()) // Should be 20
    
    const baseValue = 100
    let result = modifier.apply(baseValue)
    console.log(`Base: ${baseValue}, Modified: ${result}`) // Should be 120
    
    if (result === 120) {
      console.log('✅ Initial ref modifier test PASSED')
    } else {
      console.log('❌ Initial ref modifier test FAILED')
      return
    }
    
    // Update ref and test reactivity
    console.log('\nUpdating ref from 20 to 30...')
    valueRef.next(30)
    
    const newValue = modifier.getCurrentValue()
    console.log('New ref value:', newValue) // Should be 30
    
    const newResult = modifier.apply(baseValue)
    console.log(`Base: ${baseValue}, New Modified: ${newResult}`) // Should be 130
    
    if (newResult === 130) {
      console.log('✅ Reactive ref modifier test PASSED')
    } else {
      console.log('❌ Reactive ref modifier test FAILED')
    }
    
  } catch (error) {
    console.error('❌ Ref modifier test FAILED with error:', error)
  }
}

function testPercentModifier() {
  console.log('\n=== Testing Percent Modifier ===')
  
  try {
    const modifier = new Modifier(
      DurationType.binding,
      'percent_modifier',
      1.5, // 150%
      'percent',
      100
    )
    
    const baseValue = 100
    const result = modifier.apply(baseValue)
    console.log(`Base: ${baseValue}, Modified (150%): ${result}`) // Should be 150
    
    if (result === 150) {
      console.log('✅ Percent modifier test PASSED')
    } else {
      console.log('❌ Percent modifier test FAILED')
    }
    
  } catch (error) {
    console.error('❌ Percent modifier test FAILED with error:', error)
  }
}

function testOverrideModifier() {
  console.log('\n=== Testing Override Modifier ===')
  
  try {
    const modifier = new Modifier(
      DurationType.binding,
      'override_modifier',
      42,
      'override',
      100
    )
    
    const baseValue = 100
    const result = modifier.apply(baseValue)
    console.log(`Base: ${baseValue}, Modified (override): ${result}`) // Should be 42
    
    if (result === 42) {
      console.log('✅ Override modifier test PASSED')
    } else {
      console.log('❌ Override modifier test FAILED')
    }
    
  } catch (error) {
    console.error('❌ Override modifier test FAILED with error:', error)
  }
}

// Run all tests
export function runModifierTests() {
  console.log('Starting Modifier Tests...\n')
  
  testBasicModifier()
  testPercentModifier()
  testOverrideModifier()
  testRefModifier()
  testComputedModifier()
  
  console.log('\n=== All Tests Complete ===')
}

// Uncomment to run tests
// runModifierTests()
