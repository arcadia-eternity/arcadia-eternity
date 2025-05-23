// Example: Demonstrating clamp operations in Modifier system
import { Modifier, DurationType, ModifierHelpers, AttributeSystem, ref, computed } from '../src/attributeSystem'
import { BehaviorSubject } from 'rxjs'

// Example 1: Basic clampMax modifier
function basicClampMaxExample() {
  console.log('=== Basic ClampMax Modifier Example ===')

  // Create a clampMax modifier that limits values to maximum 100
  const clampMaxModifier = new Modifier(
    DurationType.binding,
    'clamp_max_modifier',
    100, // max value
    'clampMax',
    100,
  )

  console.log('Testing clampMax with different values:')
  console.log('50 clamped to max 100:', clampMaxModifier.apply(50)) // Should be 50
  console.log('150 clamped to max 100:', clampMaxModifier.apply(150)) // Should be 100
  console.log('100 clamped to max 100:', clampMaxModifier.apply(100)) // Should be 100
}

// Example 2: Basic clampMin modifier
function basicClampMinExample() {
  console.log('\n=== Basic ClampMin Modifier Example ===')

  // Create a clampMin modifier that limits values to minimum 10
  const clampMinModifier = new Modifier(
    DurationType.binding,
    'clamp_min_modifier',
    10, // min value
    'clampMin',
    100,
  )

  console.log('Testing clampMin with different values:')
  console.log('5 clamped to min 10:', clampMinModifier.apply(5)) // Should be 10
  console.log('15 clamped to min 10:', clampMinModifier.apply(15)) // Should be 15
  console.log('10 clamped to min 10:', clampMinModifier.apply(10)) // Should be 10
}

// Example 3: Combined clamp modifier (min and max)
function combinedClampExample() {
  console.log('\n=== Combined Clamp Modifier Example ===')

  // Create a clamp modifier that limits values between 10 and 100
  const clampModifier = new Modifier(
    DurationType.binding,
    'combined_clamp_modifier',
    0, // not used for clamp type
    'clamp',
    100,
    undefined, // no source
    10, // minValue
    100, // maxValue
  )

  console.log('Testing combined clamp with range [10, 100]:')
  console.log('5 clamped to [10, 100]:', clampModifier.apply(5)) // Should be 10
  console.log('50 clamped to [10, 100]:', clampModifier.apply(50)) // Should be 50
  console.log('150 clamped to [10, 100]:', clampModifier.apply(150)) // Should be 100
}

// Example 4: Using helper functions
function helperFunctionExample() {
  console.log('\n=== Helper Function Example ===')

  // Create modifiers using helper functions
  const maxModifier = ModifierHelpers.createClampMax('helper_max', 200, 100)
  const minModifier = ModifierHelpers.createClampMin('helper_min', 20, 100)
  const rangeModifier = ModifierHelpers.createClamp('helper_range', 30, 180, 100)

  console.log('Using helper functions:')
  console.log('250 with clampMax(200):', maxModifier.apply(250)) // Should be 200
  console.log('10 with clampMin(20):', minModifier.apply(10)) // Should be 20
  console.log('25 with clamp(30, 180):', rangeModifier.apply(25)) // Should be 30
  console.log('200 with clamp(30, 180):', rangeModifier.apply(200)) // Should be 180
}

// Example 5: Reactive clamp with observables
function reactiveClampExample() {
  console.log('\n=== Reactive Clamp Example ===')

  // Create reactive min and max values
  const minValue$ = ref(10)
  const maxValue$ = ref(100)

  // Create reactive clamp modifier
  const { modifier: reactiveClamp, cleanup } = ModifierHelpers.createReactiveClamp(
    'reactive_clamp',
    minValue$.asObservable(),
    maxValue$.asObservable(),
    100,
  )

  console.log('Initial reactive clamp [10, 100]:')
  console.log('5 clamped:', reactiveClamp.apply(5)) // Should be 10
  console.log('50 clamped:', reactiveClamp.apply(50)) // Should be 50
  console.log('150 clamped:', reactiveClamp.apply(150)) // Should be 100

  // Update the reactive values
  minValue$.next(20)
  maxValue$.next(80)

  console.log('\nAfter updating to [20, 80]:')
  console.log('15 clamped:', reactiveClamp.apply(15)) // Should be 20
  console.log('50 clamped:', reactiveClamp.apply(50)) // Should be 50
  console.log('90 clamped:', reactiveClamp.apply(90)) // Should be 80

  // Clean up subscriptions
  cleanup()
}

// Example 6: Using clamp modifiers in AttributeSystem
function attributeSystemExample() {
  console.log('\n=== AttributeSystem with Clamp Modifiers Example ===')

  // Create an attribute system
  const system = new AttributeSystem<{ attack: number }>()
  system.registerBaseAttribute('attack', 100)

  // Add various modifiers including clamps
  const deltaModifier = new Modifier(DurationType.binding, 'delta', 50, 'delta', 200)
  const percentModifier = new Modifier(DurationType.binding, 'percent', 1.5, 'percent', 300)
  const clampMaxModifier = ModifierHelpers.createClampMax('max_clamp', 200, 100)

  // Add modifiers to the system
  const cleanupDelta = system.addModifier('attack', deltaModifier)
  const cleanupPercent = system.addModifier('attack', percentModifier)
  const cleanupClamp = system.addModifier('attack', clampMaxModifier)

  console.log('Base attack:', 100)
  console.log('After delta +50:', 150)
  console.log('After percent *1.5:', 225)
  console.log('After clampMax(200):', system.getCurrentValue('attack')) // Should be 200

  // Clean up
  cleanupDelta()
  cleanupPercent()
  cleanupClamp()
}

// Example 7: Priority-based clamp application
function priorityExample() {
  console.log('\n=== Priority-based Clamp Example ===')

  const system = new AttributeSystem<{ value: number }>()
  system.registerBaseAttribute('value', 50)

  // Create modifiers with different priorities
  const deltaModifier = new Modifier(DurationType.binding, 'delta', 100, 'delta', 300) // +100
  const clampMaxModifier = ModifierHelpers.createClampMax('clamp_max', 120, 400) // max 120, higher priority
  const percentModifier = new Modifier(DurationType.binding, 'percent', 2, 'percent', 200) // *2, lower priority

  // Add modifiers
  const cleanup1 = system.addModifier('value', deltaModifier)
  const cleanup2 = system.addModifier('value', clampMaxModifier)
  const cleanup3 = system.addModifier('value', percentModifier)

  console.log('Base value:', 50)
  console.log('Application order (by priority):')
  console.log('1. ClampMax(120) - priority 400')
  console.log('2. Delta(+100) - priority 300')
  console.log('3. Percent(*2) - priority 200')
  console.log('Final result:', system.getCurrentValue('value'))

  // Clean up
  cleanup1()
  cleanup2()
  cleanup3()
}

// Run all examples
export function runClampModifierExamples() {
  basicClampMaxExample()
  basicClampMinExample()
  combinedClampExample()
  helperFunctionExample()
  reactiveClampExample()
  attributeSystemExample()
  priorityExample()
}

// Run examples if this file is executed directly
runClampModifierExamples()
