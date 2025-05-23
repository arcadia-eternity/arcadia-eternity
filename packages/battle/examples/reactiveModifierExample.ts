// Example: Demonstrating reactive Modifier with Subject<T>
import { Modifier, DurationType } from '../src/attributeSystem'
import { Subject } from 'rxjs'

// Example 1: Basic reactive modifier with static value
function basicReactiveModifierExample() {
  console.log('=== Basic Reactive Modifier Example ===')

  // Create a modifier with initial value
  const modifier = new Modifier(DurationType.binding, 'reactive_modifier', 10, 'delta', 100)

  console.log('Initial modifier value:', modifier.getCurrentValue()) // 10

  // Apply the modifier to a base value
  let baseValue = 100
  console.log('Base value:', baseValue) // 100
  console.log('Modified value:', modifier.apply(baseValue)) // 110
}

// Example 2: Reactive modifier with subscription
function reactiveModifierWithSubscriptionExample() {
  console.log('\n=== Reactive Modifier with Subscription Example ===')

  // Create a modifier
  const modifier = new Modifier(DurationType.binding, 'subscribed_modifier', 1.5, 'percent', 100)

  // Subscribe to value changes
  modifier.value.subscribe(value => {
    console.log('Modifier value changed to:', value)
  })

  console.log('Initial value:', modifier.getCurrentValue()) // 1.5

  // Update values - this will trigger the subscription
  modifier.updateValue(2.0)
  modifier.updateValue(0.5)
  modifier.updateValue(3.0)
}

// Example 3: Multiple modifiers with different types
function multipleReactiveModifiersExample() {
  console.log('\n=== Multiple Reactive Modifiers Example ===')

  // Create different types of modifiers
  const deltaModifier = new Modifier(DurationType.binding, 'delta_mod', 10, 'delta', 100)

  const percentModifier = new Modifier(DurationType.binding, 'percent_mod', 1.2, 'percent', 200)

  const overrideModifier = new Modifier(DurationType.binding, 'override_mod', 50, 'override', 300)

  let baseValue = 100

  console.log('Base value:', baseValue)
  console.log('After delta (+10):', deltaModifier.apply(baseValue))
  console.log('After percent (*1.2):', percentModifier.apply(baseValue))
  console.log('After override (=50):', overrideModifier.apply(baseValue))

  // Update values reactively
  console.log('\nUpdating modifier values...')
  deltaModifier.updateValue(25)
  percentModifier.updateValue(1.5)
  overrideModifier.updateValue(75)

  console.log('After updated delta (+25):', deltaModifier.apply(baseValue))
  console.log('After updated percent (*1.5):', percentModifier.apply(baseValue))
  console.log('After updated override (=75):', overrideModifier.apply(baseValue))
}

// Example 4: Simulating stage modifier behavior
function stageModifierSimulationExample() {
  console.log('\n=== Stage Modifier Simulation Example ===')

  // Simulate the stage modifier behavior that was previously using customFn
  const stageModifier = new Modifier(
    DurationType.binding,
    'stage_mod',
    1.0, // neutral multiplier
    'percent',
    1000,
  )

  // Function to calculate stage multiplier (similar to what was in customFn)
  function getStageMultiplier(stage: number): number {
    const validStage = Math.max(-6, Math.min(6, stage))
    const index = validStage + 6
    const STAT_STAGE_MULTIPLIER = [0.25, 0.28, 0.33, 0.4, 0.5, 0.66, 1, 1.5, 2, 2.5, 3, 3.5, 4] as const
    return STAT_STAGE_MULTIPLIER[index]
  }

  let baseValue = 100
  let currentStage = 0

  console.log(
    `Stage ${currentStage}: multiplier ${getStageMultiplier(currentStage)}, result: ${stageModifier.apply(baseValue)}`,
  )

  // Simulate stage changes
  for (let stage = -3; stage <= 3; stage++) {
    const multiplier = getStageMultiplier(stage)
    stageModifier.updateValue(multiplier)
    console.log(`Stage ${stage}: multiplier ${multiplier}, result: ${stageModifier.apply(baseValue)}`)
  }
}

// Run all examples
export function runReactiveModifierExamples() {
  basicReactiveModifierExample()
  reactiveModifierWithSubscriptionExample()
  multipleReactiveModifiersExample()
  stageModifierSimulationExample()

  console.log('\n=== Reactive Modifier Examples Complete ===')
}

// Uncomment to run examples
// runReactiveModifierExamples()
