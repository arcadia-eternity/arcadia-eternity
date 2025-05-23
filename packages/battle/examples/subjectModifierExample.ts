// Example: Demonstrating Modifier with Subject<T> input
import { Modifier, DurationType } from '../src/attributeSystem'
import { Subject } from 'rxjs'

// Example 1: Basic modifier with static value
function basicModifierExample() {
  console.log('=== Basic Modifier Example ===')
  
  // Create a modifier with static initial value
  const modifier = new Modifier(
    DurationType.binding,
    'static_modifier',
    10,
    'delta',
    100
  )
  
  console.log('Initial modifier value:', modifier.getCurrentValue()) // 10
  
  let baseValue = 100
  console.log('Base value:', baseValue) // 100
  console.log('Modified value:', modifier.apply(baseValue)) // 110
}

// Example 2: Reactive modifier with external Subject
function reactiveModifierWithSubjectExample() {
  console.log('\n=== Reactive Modifier with External Subject Example ===')
  
  // Create an external Subject to control the modifier value
  const valueSubject = new Subject<number>()
  
  // Create a modifier that uses the external Subject
  const modifier = new Modifier(
    DurationType.binding,
    'subject_modifier',
    valueSubject, // 传入Subject而不是静态值
    'percent',
    100
  )
  
  // Subscribe to value changes to see when they happen
  modifier.value.subscribe(value => {
    console.log('Modifier value changed to:', value)
  })
  
  // Set initial value through the Subject
  console.log('Setting initial value...')
  valueSubject.next(1.5)
  
  let baseValue = 100
  console.log('Base value:', baseValue)
  console.log('Modified value:', modifier.apply(baseValue)) // 150
  
  // Update values through the external Subject - this will automatically update the modifier
  console.log('\nUpdating values through Subject...')
  valueSubject.next(2.0)
  console.log('New modified value:', modifier.apply(baseValue)) // 200
  
  valueSubject.next(0.5)
  console.log('New modified value:', modifier.apply(baseValue)) // 50
  
  valueSubject.next(3.0)
  console.log('New modified value:', modifier.apply(baseValue)) // 300
}

// Example 3: Multiple modifiers sharing the same Subject
function sharedSubjectExample() {
  console.log('\n=== Shared Subject Example ===')
  
  // Create a shared Subject
  const sharedSubject = new Subject<number>()
  
  // Create multiple modifiers that share the same Subject
  const deltaModifier = new Modifier(
    DurationType.binding,
    'shared_delta',
    sharedSubject,
    'delta',
    100
  )
  
  const percentModifier = new Modifier(
    DurationType.binding,
    'shared_percent',
    sharedSubject,
    'percent',
    200
  )
  
  // Both modifiers will update when the shared Subject emits
  deltaModifier.value.subscribe(value => {
    console.log('Delta modifier updated to:', value)
  })
  
  percentModifier.value.subscribe(value => {
    console.log('Percent modifier updated to:', value)
  })
  
  let baseValue = 100
  console.log('Base value:', baseValue)
  
  // Update the shared Subject - both modifiers will be affected
  console.log('\nSetting shared value to 10...')
  sharedSubject.next(10)
  console.log('Delta result:', deltaModifier.apply(baseValue)) // 110
  console.log('Percent result:', percentModifier.apply(baseValue)) // 1000
  
  console.log('\nSetting shared value to 2...')
  sharedSubject.next(2)
  console.log('Delta result:', deltaModifier.apply(baseValue)) // 102
  console.log('Percent result:', percentModifier.apply(baseValue)) // 200
}

// Example 4: Stage modifier simulation (like the StatLevelMarkInstanceImpl)
function stageModifierSimulationExample() {
  console.log('\n=== Stage Modifier Simulation Example ===')
  
  // Create a Subject to represent stage multiplier
  const stageMultiplierSubject = new Subject<number>()
  
  // Create a modifier that uses the stage multiplier Subject
  const stageModifier = new Modifier(
    DurationType.binding,
    'stage_modifier',
    stageMultiplierSubject,
    'percent',
    1000 // High priority
  )
  
  // Function to calculate stage multiplier (similar to StatLevelMarkInstanceImpl)
  function getStageMultiplier(stage: number): number {
    const validStage = Math.max(-6, Math.min(6, stage))
    const index = validStage + 6
    const STAT_STAGE_MULTIPLIER = [0.25, 0.28, 0.33, 0.4, 0.5, 0.66, 1, 1.5, 2, 2.5, 3, 3.5, 4] as const
    return STAT_STAGE_MULTIPLIER[index]
  }
  
  // Function to update stage level
  function updateStageLevel(stage: number) {
    const multiplier = getStageMultiplier(stage)
    console.log(`Stage ${stage}: multiplier ${multiplier}`)
    stageMultiplierSubject.next(multiplier)
  }
  
  let baseValue = 100
  console.log('Base stat value:', baseValue)
  
  // Simulate stage changes
  console.log('\nSimulating stage changes...')
  
  updateStageLevel(0) // Neutral
  console.log('Result:', stageModifier.apply(baseValue)) // 100
  
  updateStageLevel(2) // +2 stages
  console.log('Result:', stageModifier.apply(baseValue)) // 200
  
  updateStageLevel(-2) // -2 stages
  console.log('Result:', stageModifier.apply(baseValue)) // 50
  
  updateStageLevel(6) // Max positive
  console.log('Result:', stageModifier.apply(baseValue)) // 400
  
  updateStageLevel(-6) // Max negative
  console.log('Result:', stageModifier.apply(baseValue)) // 25
}

// Run all examples
export function runSubjectModifierExamples() {
  basicModifierExample()
  reactiveModifierWithSubjectExample()
  sharedSubjectExample()
  stageModifierSimulationExample()
  
  console.log('\n=== Subject Modifier Examples Complete ===')
}

// Uncomment to run examples
// runSubjectModifierExamples()
