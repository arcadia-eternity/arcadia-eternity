// Example: Using AttributeSystem to manage Mark and Skill parameters
import { BaseMark, MarkInstanceImpl } from '../src/mark'
import { BaseSkill, SkillInstance } from '../src/skill'
import { Modifier, DurationType } from '../src/attributeSystem'
import { Category, Element, AttackTargetOpinion } from '@arcadia-eternity/const'

// Example 1: Creating a mark with AttributeSystem
function createExampleMark() {
  const baseMark = new BaseMark('example_mark' as any, [], {
    duration: 5,
    persistent: false,
    maxStacks: 3,
    stackable: true,
    destroyable: true,
  })

  const markInstance = baseMark.createInstance({
    duration: 3,
    stack: 2,
  })

  console.log('Mark initial values:')
  console.log('Duration:', markInstance.duration) // 3
  console.log('Stack:', markInstance.stack) // 2
  console.log('IsActive:', markInstance.isActive) // true

  // Add a modifier to increase duration
  const durationModifier = new Modifier(DurationType.binding, 'duration_boost', 2, 'delta', 100, markInstance)

  const cleanup = markInstance.attributeSystem.addModifier('duration', durationModifier)

  console.log('After adding duration modifier:')
  console.log('Duration:', markInstance.duration) // 5 (3 + 2)

  // Clean up modifier
  cleanup()
  console.log('After removing modifier:')
  console.log('Duration:', markInstance.duration) // 3

  return markInstance
}

// Example 2: Creating a skill with AttributeSystem
function createExampleSkill() {
  const baseSkill = new BaseSkill(
    'example_skill' as any,
    Category.Physical,
    Element.Fire,
    80, // power
    90, // accuracy
    20, // rage
    0, // priority
    AttackTargetOpinion.opponent,
    1, // multihit
    false, // sureHit
    false, // sureCrit
    false, // ignoreShield
    ['fire', 'physical'],
  )

  const skillInstance = new SkillInstance(baseSkill, {
    power: 100,
    accuracy: 95,
  })

  console.log('Skill initial values:')
  console.log('Power:', skillInstance.power) // 100
  console.log('Accuracy:', skillInstance.accuracy) // 95
  console.log('Rage:', skillInstance.rage) // 20
  console.log('Priority:', skillInstance.priority) // 0

  // Add a modifier to boost power
  const powerModifier = new Modifier(DurationType.binding, 'power_boost', 1.5, 'percent', 200, skillInstance as any)

  const cleanup = skillInstance.attributeSystem.addModifier('power', powerModifier)

  console.log('After adding power modifier:')
  console.log('Power:', skillInstance.power) // 150 (100 * 1.5)

  // Add a modifier to increase priority
  const priorityModifier = new Modifier(DurationType.binding, 'priority_boost', 1, 'delta', 150, skillInstance as any)

  const priorityCleanup = skillInstance.attributeSystem.addModifier('priority', priorityModifier)

  console.log('After adding priority modifier:')
  console.log('Priority:', skillInstance.priority) // 1 (0 + 1)

  // Clean up modifiers
  cleanup()
  priorityCleanup()
  console.log('After removing modifiers:')
  console.log('Power:', skillInstance.power) // 100
  console.log('Priority:', skillInstance.priority) // 0

  return skillInstance
}

// Example 3: Using custom modifiers
function createCustomModifierExample() {
  const baseSkill = new BaseSkill('custom_skill' as any, Category.Special, Element.Water, 60, 85, 15)

  const skillInstance = new SkillInstance(baseSkill)

  // Override modifier that sets power to 120 (replaces custom cap functionality)
  const powerCapModifier = new Modifier(
    DurationType.binding,
    'power_cap',
    120,
    'override',
    1000, // High priority to apply last
    skillInstance as any,
  )

  // First add a power boost
  const powerBoostModifier = new Modifier(DurationType.binding, 'power_boost', 50, 'delta', 100, skillInstance as any)

  const boostCleanup = skillInstance.attributeSystem.addModifier('power', powerBoostModifier)
  const capCleanup = skillInstance.attributeSystem.addModifier('power', powerCapModifier)

  console.log('Custom modifier example:')
  console.log('Base power:', 60)
  console.log('After boost (+50):', skillInstance.power) // Should be 110 (60 + 50)

  // Add another boost that would exceed the cap
  const extraBoostModifier = new Modifier(DurationType.binding, 'extra_boost', 30, 'delta', 100, skillInstance as any)

  const extraCleanup = skillInstance.attributeSystem.addModifier('power', extraBoostModifier)

  console.log('After extra boost (+30):', skillInstance.power) // Should be 120 (capped)

  // Clean up
  boostCleanup()
  capCleanup()
  extraCleanup()

  return skillInstance
}

// Example 4: Reactive updates
function reactiveUpdatesExample() {
  const baseMark = new BaseMark('reactive_mark' as any, [])
  const markInstance = baseMark.createInstance()

  // Subscribe to duration changes
  markInstance.attributeSystem.getAttribute$('duration').subscribe(duration => {
    console.log('Duration changed to:', duration)
  })

  // Subscribe to stack changes
  markInstance.attributeSystem.getAttribute$('stack').subscribe(stack => {
    console.log('Stack changed to:', stack)
  })

  console.log('Reactive updates example:')

  // These changes will trigger the subscriptions
  markInstance.duration = 10
  markInstance.stack = 5

  // Add a modifier
  const modifier = new Modifier(DurationType.binding, 'test_modifier', 2, 'delta', 100, markInstance)

  const cleanup = markInstance.attributeSystem.addModifier('duration', modifier)

  // Remove modifier
  cleanup()

  return markInstance
}

// Run examples
export function runAttributeSystemExamples() {
  console.log('=== AttributeSystem Examples ===\n')

  console.log('1. Mark Example:')
  createExampleMark()
  console.log('\n')

  console.log('2. Skill Example:')
  createExampleSkill()
  console.log('\n')

  console.log('3. Custom Modifier Example:')
  createCustomModifierExample()
  console.log('\n')

  console.log('4. Reactive Updates Example:')
  reactiveUpdatesExample()
  console.log('\n')

  console.log('=== Examples Complete ===')
}

// Uncomment to run examples
// runAttributeSystemExamples()
