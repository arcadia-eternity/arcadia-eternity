// Example: Using skill attribute modifier operators
import type { EffectDSL } from '@arcadia-eternity/schema'

// Example 1: Basic skill power boost - Increase power by 50 points
export const skillPowerBoostEffect: EffectDSL = {
  id: 'skill_power_boost_effect',
  trigger: 'OnTurnStart',
  priority: 100,
  apply: {
    type: 'addSkillAttributeModifier',
    target: { base: 'selfSkills' },
    attribute: 'power',
    modifierType: 'delta',
    value: 50,
    priority: 100,
  },
}

// Example 2: Skill accuracy reduction - Reduce accuracy by 20%
export const skillAccuracyDebuffEffect: EffectDSL = {
  id: 'skill_accuracy_debuff_effect',
  trigger: 'OnTurnStart',
  priority: 100,
  apply: {
    type: 'addSkillAttributeModifier',
    target: { base: 'foeSkills' },
    attribute: 'accuracy',
    modifierType: 'percent',
    value: -20,
    priority: 200,
  },
}

// Example 3: Rage cost reduction - Reduce rage cost by 10 points
export const skillRageCostReductionEffect: EffectDSL = {
  id: 'skill_rage_cost_reduction_effect',
  trigger: 'OnTurnStart',
  priority: 100,
  apply: {
    type: 'addSkillAttributeModifier',
    target: { base: 'selfSkills' },
    attribute: 'rage',
    modifierType: 'delta',
    value: -10,
    priority: 150,
  },
}

// Example 4: Priority boost for specific skills - Increase priority by 1
export const skillPriorityBoostEffect: EffectDSL = {
  id: 'skill_priority_boost_effect',
  trigger: 'OnTurnStart',
  priority: 100,
  apply: {
    type: 'addSkillAttributeModifier',
    target: {
      base: 'selfSkills',
      chain: [
        {
          type: 'where',
          arg: {
            type: 'evaluate',
            target: {
              type: 'selectPath',
              arg: 'base.element'
            },
            evaluator: {
              type: 'same',
              value: 'Fire'
            }
          }
        }
      ]
    },
    attribute: 'priority',
    modifierType: 'delta',
    value: 1,
    priority: 300,
  },
}

// Example 5: Dynamic skill power based on HP - Lower HP = Higher power
export const dynamicSkillPowerEffect: EffectDSL = {
  id: 'dynamic_skill_power_effect',
  trigger: 'OnTurnStart',
  priority: 100,
  apply: {
    type: 'addDynamicSkillAttributeModifier',
    target: { base: 'selfSkills' },
    attribute: 'power',
    modifierType: 'delta',
    observableValue: {
      base: 'self',
      chain: [
        { type: 'selectAttribute$', arg: 'currentHp' },
        { type: 'multiply', arg: -2 },   // Inverse relationship
        { type: 'add', arg: 200 },       // Base bonus of 200
        { type: 'clampMax', arg: 150 },  // Maximum 150 bonus
        { type: 'clampMin', arg: 0 }     // Minimum 0 bonus
      ]
    },
    priority: 250,
  },
}

// Example 6: Clamp skill power to maximum 999
export const skillPowerCapEffect: EffectDSL = {
  id: 'skill_power_cap_effect',
  trigger: 'OnTurnStart',
  priority: 100,
  apply: {
    type: 'addSkillClampMaxModifier',
    target: { base: 'selfSkills' },
    attribute: 'power',
    maxValue: 999,
    priority: 500,
  },
}

// Example 7: Ensure minimum skill accuracy of 30%
export const skillAccuracyFloorEffect: EffectDSL = {
  id: 'skill_accuracy_floor_effect',
  trigger: 'OnTurnStart',
  priority: 100,
  apply: {
    type: 'addSkillClampMinModifier',
    target: { base: 'selfSkills' },
    attribute: 'accuracy',
    minValue: 30,
    priority: 400,
  },
}

// Example 8: Clamp skill rage cost between 5 and 100
export const skillRageCostClampEffect: EffectDSL = {
  id: 'skill_rage_cost_clamp_effect',
  trigger: 'OnTurnStart',
  priority: 100,
  apply: {
    type: 'addSkillClampModifier',
    target: { base: 'selfSkills' },
    attribute: 'rage',
    minValue: 5,
    maxValue: 100,
    priority: 350,
  },
}

// Example 9: Complex conditional skill modifier - Different effects based on conditions
export const conditionalSkillModifierEffect: EffectDSL = {
  id: 'conditional_skill_modifier_effect',
  trigger: 'OnTurnStart',
  priority: 100,
  apply: {
    type: 'conditional',
    condition: {
      type: 'evaluate',
      target: {
        base: 'self',
        chain: [
          { type: 'selectPath', arg: 'currentHp' }
        ]
      },
      evaluator: {
        type: 'compare',
        operator: '<',
        value: 50 // Less than 50% HP
      }
    },
    trueOperator: {
      type: 'addSkillAttributeModifier',
      target: { base: 'selfSkills' },
      attribute: 'power',
      modifierType: 'percent',
      value: 50, // 50% power boost when low HP
      priority: 600,
    },
    falseOperator: {
      type: 'addSkillAttributeModifier',
      target: { base: 'selfSkills' },
      attribute: 'accuracy',
      modifierType: 'percent',
      value: 25, // 25% accuracy boost when high HP
      priority: 600,
    }
  },
}

// Example 10: Multiple skill modifiers in one effect
export const multipleSkillModifiersEffect: EffectDSL = {
  id: 'multiple_skill_modifiers_effect',
  trigger: 'OnTurnStart',
  priority: 100,
  apply: [
    {
      type: 'addSkillAttributeModifier',
      target: { base: 'selfSkills' },
      attribute: 'power',
      modifierType: 'percent',
      value: 20,
      priority: 100,
    },
    {
      type: 'addSkillAttributeModifier',
      target: { base: 'selfSkills' },
      attribute: 'accuracy',
      modifierType: 'delta',
      value: 10,
      priority: 100,
    },
    {
      type: 'addSkillAttributeModifier',
      target: { base: 'selfSkills' },
      attribute: 'rage',
      modifierType: 'delta',
      value: -5,
      priority: 100,
    }
  ],
}

// Export all examples for easy access
export const SkillModifierExamples = {
  skillPowerBoostEffect,
  skillAccuracyDebuffEffect,
  skillRageCostReductionEffect,
  skillPriorityBoostEffect,
  dynamicSkillPowerEffect,
  skillPowerCapEffect,
  skillAccuracyFloorEffect,
  skillRageCostClampEffect,
  conditionalSkillModifierEffect,
  multipleSkillModifiersEffect,
}

// Usage documentation
export const SkillModifierDocumentation = {
  description: 'Skill Attribute Modifier Operators allow you to modify skill attributes (power, accuracy, rage, priority) using the Game Ability System.',
  
  operators: {
    addSkillAttributeModifier: {
      description: 'Add a static modifier to skill attributes',
      parameters: {
        target: 'SkillInstance selector (e.g., selfSkills, foeSkills)',
        attribute: 'Skill attribute to modify (power, accuracy, rage, priority)',
        modifierType: 'Type of modification (percent, delta, override)',
        value: 'Static value for the modifier',
        priority: 'Priority for modifier application (higher = applied first)'
      }
    },
    
    addDynamicSkillAttributeModifier: {
      description: 'Add a dynamic modifier to skill attributes using Observable values',
      parameters: {
        target: 'SkillInstance selector',
        attribute: 'Skill attribute to modify',
        modifierType: 'Type of modification',
        observableValue: 'Observable value source that updates dynamically',
        priority: 'Priority for modifier application'
      }
    },
    
    addSkillClampMaxModifier: {
      description: 'Limit the maximum value of a skill attribute',
      parameters: {
        target: 'SkillInstance selector',
        attribute: 'Skill attribute to clamp',
        maxValue: 'Maximum allowed value',
        priority: 'Priority for modifier application'
      }
    },
    
    addSkillClampMinModifier: {
      description: 'Limit the minimum value of a skill attribute',
      parameters: {
        target: 'SkillInstance selector',
        attribute: 'Skill attribute to clamp',
        minValue: 'Minimum allowed value',
        priority: 'Priority for modifier application'
      }
    },
    
    addSkillClampModifier: {
      description: 'Limit both minimum and maximum values of a skill attribute',
      parameters: {
        target: 'SkillInstance selector',
        attribute: 'Skill attribute to clamp',
        minValue: 'Minimum allowed value',
        maxValue: 'Maximum allowed value',
        priority: 'Priority for modifier application'
      }
    }
  },
  
  notes: [
    'Modifiers are automatically bound to mark lifecycles when the effect source is a mark',
    'Higher priority modifiers are applied first',
    'Percent modifiers are multiplicative (100 + value)%',
    'Delta modifiers are additive',
    'Override modifiers replace the base value entirely',
    'Clamp modifiers are applied after all other modifiers',
    'Use selfSkills/foeSkills selectors to target skills',
    'Chain selectors with where() to target specific skills'
  ]
}
