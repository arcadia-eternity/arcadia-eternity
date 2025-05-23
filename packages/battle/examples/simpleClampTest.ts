// Simple test for clamp modifiers
import { Modifier, DurationType, ModifierHelpers, AttributeSystem } from '../src/attributeSystem'

// Test 1: Basic clamp functionality
function testBasicClamp() {
  console.log('=== Testing Basic Clamp Functionality ===')
  
  const system = new AttributeSystem<{ value: number }>()
  system.registerBaseAttribute('value', 50)
  
  // Test clampMax
  const clampMaxModifier = ModifierHelpers.createClampMax('clamp_max', 100, 100)
  const cleanupMax = system.addModifier('value', clampMaxModifier)
  
  console.log('Base value:', system.getCurrentValue('value')) // 50
  
  // Add a delta that would exceed the max
  const deltaModifier = new Modifier(DurationType.binding, 'delta', 80, 'delta', 200)
  const cleanupDelta = system.addModifier('value', deltaModifier)
  
  console.log('After +80 with clampMax(100):', system.getCurrentValue('value')) // Should be 100
  
  cleanupMax()
  cleanupDelta()
}

// Test 2: Combined clamp with min and max
function testCombinedClamp() {
  console.log('\n=== Testing Combined Clamp ===')
  
  const system = new AttributeSystem<{ stat: number }>()
  system.registerBaseAttribute('stat', 75)
  
  // Add combined clamp [50, 120]
  const clampModifier = ModifierHelpers.createClamp('combined_clamp', 50, 120, 100)
  const cleanupClamp = system.addModifier('stat', clampModifier)
  
  console.log('Base stat:', system.getCurrentValue('stat')) // 75
  
  // Test exceeding max
  const percentModifier = new Modifier(DurationType.binding, 'percent', 2.0, 'percent', 200)
  const cleanupPercent = system.addModifier('stat', percentModifier)
  
  console.log('After *2.0 with clamp[50,120]:', system.getCurrentValue('stat')) // Should be 120
  
  // Test going below min
  const deltaModifier = new Modifier(DurationType.binding, 'delta', -100, 'delta', 300)
  const cleanupDelta = system.addModifier('stat', deltaModifier)
  
  console.log('After -100 with clamp[50,120]:', system.getCurrentValue('stat')) // Should be 50
  
  cleanupClamp()
  cleanupPercent()
  cleanupDelta()
}

// Test 3: Priority ordering with clamps
function testClampPriority() {
  console.log('\n=== Testing Clamp Priority ===')
  
  const system = new AttributeSystem<{ power: number }>()
  system.registerBaseAttribute('power', 100)
  
  // Add modifiers with different priorities
  const deltaModifier = new Modifier(DurationType.binding, 'delta', 50, 'delta', 200) // +50
  const clampMaxModifier = ModifierHelpers.createClampMax('clamp_max', 130, 300) // max 130, higher priority
  const percentModifier = new Modifier(DurationType.binding, 'percent', 1.5, 'percent', 100) // *1.5, lower priority
  
  const cleanup1 = system.addModifier('power', deltaModifier)
  const cleanup2 = system.addModifier('power', clampMaxModifier)
  const cleanup3 = system.addModifier('power', percentModifier)
  
  console.log('Base power:', 100)
  console.log('Modifiers applied by priority:')
  console.log('1. ClampMax(130) - priority 300')
  console.log('2. Delta(+50) - priority 200')
  console.log('3. Percent(*1.5) - priority 100')
  console.log('Final power:', system.getCurrentValue('power'))
  
  // Calculation: 100 -> clampMax(130) -> +50 = 150 -> clampMax(130) = 130 -> *1.5 = 195 -> clampMax(130) = 130
  
  cleanup1()
  cleanup2()
  cleanup3()
}

// Test 4: Multiple clamp modifiers
function testMultipleClamps() {
  console.log('\n=== Testing Multiple Clamp Modifiers ===')
  
  const system = new AttributeSystem<{ attribute: number }>()
  system.registerBaseAttribute('attribute', 80)
  
  // Add multiple clamp modifiers with different priorities
  const clampMax1 = ModifierHelpers.createClampMax('clamp_max_1', 150, 300) // max 150, high priority
  const clampMax2 = ModifierHelpers.createClampMax('clamp_max_2', 120, 200) // max 120, medium priority
  const clampMin = ModifierHelpers.createClampMin('clamp_min', 60, 100) // min 60, low priority
  
  const cleanup1 = system.addModifier('attribute', clampMax1)
  const cleanup2 = system.addModifier('attribute', clampMax2)
  const cleanup3 = system.addModifier('attribute', clampMin)
  
  console.log('Base attribute:', system.getCurrentValue('attribute')) // Should be 80
  
  // Add a large positive modifier
  const deltaModifier = new Modifier(DurationType.binding, 'delta', 100, 'delta', 250)
  const cleanupDelta = system.addModifier('attribute', deltaModifier)
  
  console.log('After +100 with multiple clamps:', system.getCurrentValue('attribute')) // Should be 120 (most restrictive max)
  
  cleanup1()
  cleanup2()
  cleanup3()
  cleanupDelta()
}

// Run all tests
function runAllClampTests() {
  testBasicClamp()
  testCombinedClamp()
  testClampPriority()
  testMultipleClamps()
  
  console.log('\n=== All Clamp Tests Completed Successfully! ===')
}

// Execute tests
runAllClampTests()
