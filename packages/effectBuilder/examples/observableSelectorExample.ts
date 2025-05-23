// Example: Using new Observable selector syntax for dynamic modifiers
import { BaseSelector } from '../src/selector'
import { Operators } from '../src/operator'

// Example 1: Using selectObservable to get an ObservableRef
function exampleSelectObservable() {
  console.log('=== selectObservable Example ===')
  
  // Select a pet's attribute as an ObservableRef
  // This allows both getting the current value and subscribing to changes
  const petHpObservableRef = BaseSelector.self.selectObservable('currentHp')
  
  // In an effect context, this would return ObservableRef objects that can:
  // - Get current value: ref.get()
  // - Get Observable stream: ref.get$()
  // - Set value: ref.set(newValue)
  
  console.log('Pet HP ObservableRef selector created')
  return petHpObservableRef
}

// Example 2: Using selectAttribute$ to get Observable directly
function exampleSelectAttributeStream() {
  console.log('=== selectAttribute$ Example ===')
  
  // Select a pet's attribute as an Observable stream
  // This directly returns the Observable from the attribute system
  const petAtkStream = BaseSelector.self.selectAttribute$('atk')
  
  // In an effect context, this would return Observable<number> that emits
  // whenever the pet's attack stat changes
  
  console.log('Pet ATK Observable stream selector created')
  return petAtkStream
}

// Example 3: Creating dynamic modifiers using Observable values
function exampleDynamicModifier() {
  console.log('=== Dynamic Modifier Example ===')
  
  // Create a modifier that scales with another pet's HP
  // The modifier value will automatically update when the source pet's HP changes
  const dynamicModifierEffect = {
    id: 'dynamic_hp_scaling',
    trigger: 'OnTurnStart' as any,
    priority: 100,
    apply: {
      type: 'addDynamicAttributeModifier' as const,
      target: { base: 'self' },
      stat: 'atk',
      modifierType: 'percent',
      // This selector gets the Observable stream of the pet's current HP percentage
      observableValue: {
        base: 'self',
        chain: [
          { type: 'selectAttribute$', arg: 'currentHp' },
          // Could add mathematical operations here to transform the value
          { type: 'divide', arg: 100 }, // Convert to percentage
        ]
      },
      priority: 200
    }
  }
  
  console.log('Dynamic modifier effect created:', dynamicModifierEffect)
  return dynamicModifierEffect
}

// Example 4: Complex dynamic modifier based on multiple attributes
function exampleComplexDynamicModifier() {
  console.log('=== Complex Dynamic Modifier Example ===')
  
  // Create a modifier that scales based on the difference between self and foe stats
  const complexModifierEffect = {
    id: 'stat_difference_scaling',
    trigger: 'OnTurnStart' as any,
    priority: 100,
    apply: {
      type: 'addDynamicAttributeModifier' as const,
      target: { base: 'self' },
      stat: 'spa',
      modifierType: 'delta',
      // This could be a computed Observable that combines multiple attribute streams
      observableValue: {
        base: 'foe',
        chain: [
          { type: 'selectAttribute$', arg: 'def' },
          // In a real implementation, this would need additional operators
          // to combine with self stats and calculate the difference
        ]
      },
      priority: 150
    }
  }
  
  console.log('Complex dynamic modifier effect created:', complexModifierEffect)
  return complexModifierEffect
}

// Example 5: Using ObservableRef for conditional effects
function exampleConditionalObservableEffect() {
  console.log('=== Conditional Observable Effect Example ===')
  
  // Create an effect that applies different modifiers based on HP percentage
  const conditionalEffect = {
    id: 'hp_based_conditional',
    trigger: 'OnTurnStart' as any,
    priority: 100,
    apply: {
      type: 'conditional' as const,
      condition: {
        type: 'evaluate',
        target: {
          base: 'self',
          chain: [
            { type: 'selectObservable', arg: 'currentHp' }
          ]
        },
        evaluator: {
          type: 'compare',
          operator: '<',
          value: 50 // Less than 50% HP
        }
      },
      trueOperator: {
        type: 'addDynamicAttributeModifier' as const,
        target: { base: 'self' },
        stat: 'spe',
        modifierType: 'percent',
        observableValue: {
          base: 'self',
          chain: [
            { type: 'selectAttribute$', arg: 'currentHp' },
            { type: 'multiply', arg: -1 }, // Inverse relationship
            { type: 'add', arg: 100 }      // Speed boost when low HP
          ]
        },
        priority: 300
      }
    }
  }
  
  console.log('Conditional Observable effect created:', conditionalEffect)
  return conditionalEffect
}

// Example usage documentation
export const ObservableSelectorExamples = {
  selectObservable: exampleSelectObservable,
  selectAttributeStream: exampleSelectAttributeStream,
  dynamicModifier: exampleDynamicModifier,
  complexDynamicModifier: exampleComplexDynamicModifier,
  conditionalObservableEffect: exampleConditionalObservableEffect
}

// Usage notes:
/*
1. selectObservable(prop): Returns ObservableRef<T, V> with get(), get$(), and set() methods
   - Use when you need both current value access and reactive updates
   - Works with any object property that has an attributeSystem

2. selectAttribute$(attributeName): Returns Observable<number | boolean | string>
   - Use when you only need the reactive stream
   - Directly accesses the attributeSystem.getAttribute$() method
   - More efficient for pure reactive scenarios

3. addDynamicAttributeModifier: Creates modifiers with Observable value sources
   - The modifier value automatically updates when the Observable emits
   - Bound to mark lifecycle for automatic cleanup
   - Supports all modifier types: 'percent', 'delta', 'override'

4. Integration with existing system:
   - Works seamlessly with existing selectors and operators
   - Maintains type safety through TypeScript
   - Follows the same DSL patterns as other selectors

5. Performance considerations:
   - Observable subscriptions are automatically managed
   - Cleanup happens when marks are destroyed
   - Uses RxJS operators for efficient stream processing
*/
