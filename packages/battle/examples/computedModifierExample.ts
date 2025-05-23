// Example: Demonstrating Vue-like computed with RxJS for Modifier
import { Modifier, DurationType, computed, ref } from '../src/attributeSystem'

// Example 1: Basic computed modifier
function basicComputedExample() {
  console.log('=== Basic Computed Example ===')
  
  // Create reactive refs (like Vue's ref)
  const baseValue = ref(10)
  const multiplier = ref(2)
  
  // Create computed value (like Vue's computed)
  const computedValue = computed(
    () => baseValue.value * multiplier.value,
    [baseValue, multiplier]
  )
  
  // Create modifier using computed value
  const modifier = new Modifier(
    DurationType.binding,
    'computed_modifier',
    computedValue, // 传入computed Observable
    'delta',
    100
  )
  
  // Subscribe to see changes
  modifier.value.subscribe(value => {
    console.log('Modifier value changed to:', value)
  })
  
  console.log('Initial computed value:', modifier.getCurrentValue()) // 20
  
  let testValue = 100
  console.log('Base test value:', testValue)
  console.log('Modified value:', modifier.apply(testValue)) // 120
  
  // Update base value - computed will automatically recalculate
  console.log('\nUpdating base value from 10 to 15...')
  baseValue.next(15)
  console.log('New modified value:', modifier.apply(testValue)) // 130 (100 + 15*2)
  
  // Update multiplier - computed will automatically recalculate
  console.log('\nUpdating multiplier from 2 to 3...')
  multiplier.next(3)
  console.log('New modified value:', modifier.apply(testValue)) // 145 (100 + 15*3)
}

// Example 2: Complex computed with multiple dependencies
function complexComputedExample() {
  console.log('\n=== Complex Computed Example ===')
  
  // Create multiple reactive refs
  const level = ref(1)
  const basePower = ref(50)
  const bonus = ref(10)
  
  // Create complex computed value
  const finalPower = computed(
    () => {
      const levelBonus = level.value * 5
      const totalPower = basePower.value + levelBonus + bonus.value
      console.log(`Computing: level=${level.value}, base=${basePower.value}, bonus=${bonus.value} => ${totalPower}`)
      return totalPower
    },
    [level, basePower, bonus]
  )
  
  // Create modifier using the complex computed
  const powerModifier = new Modifier(
    DurationType.binding,
    'power_modifier',
    finalPower,
    'override', // Override the base value completely
    200
  )
  
  let baseValue = 100
  console.log('Base value:', baseValue)
  console.log('Modified value:', powerModifier.apply(baseValue)) // Should be computed value
  
  // Update level
  console.log('\nLeveling up from 1 to 5...')
  level.next(5)
  console.log('New modified value:', powerModifier.apply(baseValue))
  
  // Update base power
  console.log('\nIncreasing base power from 50 to 80...')
  basePower.next(80)
  console.log('New modified value:', powerModifier.apply(baseValue))
  
  // Update bonus
  console.log('\nAdding bonus from 10 to 25...')
  bonus.next(25)
  console.log('New modified value:', powerModifier.apply(baseValue))
}

// Example 3: Stage modifier simulation (like StatLevelMarkInstanceImpl)
function stageComputedExample() {
  console.log('\n=== Stage Computed Example ===')
  
  // Create reactive stage level
  const stageLevel = ref(0)
  
  // Create computed stage multiplier
  const stageMultiplier = computed(
    () => {
      const stage = stageLevel.value
      const validStage = Math.max(-6, Math.min(6, stage))
      const index = validStage + 6
      const MULTIPLIERS = [0.25, 0.28, 0.33, 0.4, 0.5, 0.66, 1, 1.5, 2, 2.5, 3, 3.5, 4] as const
      const multiplier = MULTIPLIERS[index]
      console.log(`Stage ${stage} => multiplier ${multiplier}`)
      return multiplier
    },
    [stageLevel]
  )
  
  // Create stage modifier
  const stageModifier = new Modifier(
    DurationType.binding,
    'stage_modifier',
    stageMultiplier,
    'percent',
    1000
  )
  
  let baseStat = 100
  console.log('Base stat:', baseStat)
  
  // Test different stage levels
  const stages = [0, 2, -2, 6, -6, 1, -1]
  
  for (const stage of stages) {
    stageLevel.next(stage)
    const result = stageModifier.apply(baseStat)
    console.log(`Stage ${stage}: ${baseStat} => ${result}`)
  }
}

// Example 4: Multiple modifiers with shared computed dependencies
function sharedComputedExample() {
  console.log('\n=== Shared Computed Dependencies Example ===')
  
  // Shared reactive values
  const playerLevel = ref(10)
  const equipmentBonus = ref(20)
  
  // Shared computed base bonus
  const baseBonus = computed(
    () => playerLevel.value + equipmentBonus.value,
    [playerLevel, equipmentBonus]
  )
  
  // Different computed values based on the shared base
  const attackBonus = computed(
    () => baseBonus.value * 1.5, // Attack gets 1.5x multiplier
    [baseBonus]
  )
  
  const defenseBonus = computed(
    () => baseBonus.value * 1.2, // Defense gets 1.2x multiplier
    [baseBonus]
  )
  
  // Create modifiers using the computed values
  const attackModifier = new Modifier(
    DurationType.binding,
    'attack_modifier',
    attackBonus,
    'delta',
    100
  )
  
  const defenseModifier = new Modifier(
    DurationType.binding,
    'defense_modifier',
    defenseBonus,
    'delta',
    100
  )
  
  let baseAttack = 50
  let baseDefense = 40
  
  console.log('Base attack:', baseAttack, 'Base defense:', baseDefense)
  console.log('Modified attack:', attackModifier.apply(baseAttack))
  console.log('Modified defense:', defenseModifier.apply(baseDefense))
  
  // Update player level - both modifiers will be affected
  console.log('\nPlayer levels up from 10 to 15...')
  playerLevel.next(15)
  console.log('Modified attack:', attackModifier.apply(baseAttack))
  console.log('Modified defense:', defenseModifier.apply(baseDefense))
  
  // Update equipment - both modifiers will be affected
  console.log('\nEquipment bonus increases from 20 to 35...')
  equipmentBonus.next(35)
  console.log('Modified attack:', attackModifier.apply(baseAttack))
  console.log('Modified defense:', defenseModifier.apply(baseDefense))
}

// Run all examples
export function runComputedModifierExamples() {
  basicComputedExample()
  complexComputedExample()
  stageComputedExample()
  sharedComputedExample()
  
  console.log('\n=== Computed Modifier Examples Complete ===')
}

// Uncomment to run examples
// runComputedModifierExamples()
