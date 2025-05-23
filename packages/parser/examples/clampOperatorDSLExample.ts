// Example: Using clamp operators in DSL format
import type { EffectDSL } from '@arcadia-eternity/schema'

// Example 1: ClampMax modifier - Limit attack to maximum 999
export const attackCapEffect: EffectDSL = {
  id: 'attack_cap_effect',
  trigger: 'OnTurnStart',
  priority: 100,
  apply: {
    type: 'addClampMaxModifier',
    target: { base: 'self' },
    stat: { type: 'raw:string', value: 'atk' },
    maxValue: { type: 'raw:number', value: 999 },
    priority: { type: 'raw:number', value: 100 },
  },
}

// Example 2: ClampMin modifier - Ensure defense doesn't go below 10
export const defenseFloorEffect: EffectDSL = {
  id: 'defense_floor_effect',
  trigger: 'OnTurnStart',
  priority: 100,
  apply: {
    type: 'addClampMinModifier',
    target: { base: 'self' },
    stat: { type: 'raw:string', value: 'def' },
    minValue: { type: 'raw:number', value: 10 },
    priority: { type: 'raw:number', value: 100 },
  },
}

// Example 3: Combined clamp modifier - Keep speed between 50 and 200
export const speedRangeEffect: EffectDSL = {
  id: 'speed_range_effect',
  trigger: 'OnTurnStart',
  priority: 100,
  apply: {
    type: 'addClampModifier',
    target: { base: 'self' },
    stat: { type: 'raw:string', value: 'spe' },
    minValue: { type: 'raw:number', value: 50 },
    maxValue: { type: 'raw:number', value: 200 },
    priority: { type: 'raw:number', value: 100 },
  },
}

// Example 4: Dynamic clamp based on level
export const levelBasedHPCapEffect: EffectDSL = {
  id: 'level_based_hp_cap',
  trigger: 'OnTurnStart',
  priority: 100,
  apply: {
    type: 'addClampMaxModifier',
    target: { base: 'self' },
    stat: { type: 'raw:string', value: 'hp' },
    maxValue: {
      type: 'dynamic',
      selector: {
        base: 'self',
        chain: [
          { type: 'selectProp', arg: 'level' },
          { type: 'multiply', arg: { type: 'raw:number', value: 100 } },
          { type: 'add', arg: { type: 'raw:number', value: 500 } },
        ],
      },
    },
    priority: { type: 'raw:number', value: 200 },
  },
}

// Example 5: Conditional clamp - Only apply when HP is low
export const emergencyDefenseBoostEffect: EffectDSL = {
  id: 'emergency_defense_boost',
  trigger: 'OnTurnStart',
  priority: 100,
  condition: {
    type: 'evaluate',
    target: { base: 'self' },
    evaluator: {
      type: 'compare',
      operator: '<',
      value: { type: 'raw:number', value: 50 }, // Simplified condition
    },
  },
  apply: {
    type: 'addClampMinModifier',
    target: { base: 'self' },
    stat: { type: 'raw:string', value: 'def' },
    minValue: { type: 'raw:number', value: 100 },
    priority: { type: 'raw:number', value: 300 },
  },
}

// Example 6: Multiple effects with different priorities
export const balancedStatsEffect: EffectDSL = {
  id: 'balanced_stats_effect',
  trigger: 'OnTurnStart',
  priority: 100,
  apply: [
    // First, apply stat boosts
    {
      type: 'addAttributeModifier',
      target: { base: 'self' },
      stat: { type: 'raw:string', value: 'atk' },
      modifierType: { type: 'raw:string', value: 'delta' },
      value: { type: 'raw:number', value: 50 },
      priority: { type: 'raw:number', value: 200 },
    },
    // Then, clamp the result to prevent overpowered stats
    {
      type: 'addClampMaxModifier',
      target: { base: 'self' },
      stat: { type: 'raw:string', value: 'atk' },
      maxValue: { type: 'raw:number', value: 300 },
      priority: { type: 'raw:number', value: 100 },
    },
    // Ensure minimum defense
    {
      type: 'addClampMinModifier',
      target: { base: 'self' },
      stat: { type: 'raw:string', value: 'def' },
      minValue: { type: 'raw:number', value: 50 },
      priority: { type: 'raw:number', value: 100 },
    },
  ],
}

// Example 7: Using clamp with percentage-based calculations
export const percentageBasedClampEffect: EffectDSL = {
  id: 'percentage_based_clamp',
  trigger: 'OnTurnStart',
  priority: 100,
  apply: {
    type: 'addClampModifier',
    target: { base: 'self' },
    stat: { type: 'raw:string', value: 'spa' },
    minValue: { type: 'raw:number', value: 50 }, // Simplified to static values
    maxValue: { type: 'raw:number', value: 200 },
    priority: { type: 'raw:number', value: 100 },
  },
}

// Example 8: Clamp with configurable values
export const configurableClampEffect: EffectDSL = {
  id: 'configurable_clamp',
  trigger: 'OnTurnStart',
  priority: 100,
  apply: {
    type: 'addClampModifier',
    target: { base: 'self' },
    stat: { type: 'raw:string', value: 'spe' },
    minValue: {
      type: 'raw:number',
      value: 30,
      configId: 'speed_min_limit',
    },
    maxValue: {
      type: 'raw:number',
      value: 150,
      configId: 'speed_max_limit',
    },
    priority: { type: 'raw:number', value: 100 },
  },
}

// Example 9: Clamp targeting multiple pets
export const teamWideClampEffect: EffectDSL = {
  id: 'team_wide_clamp',
  trigger: 'OnTurnStart',
  priority: 100,
  apply: {
    type: 'addClampMaxModifier',
    target: {
      base: 'allPets',
      chain: [
        {
          type: 'where',
          arg: {
            type: 'same',
            value: {
              type: 'dynamic',
              selector: { base: 'self' },
            },
          },
        },
      ],
    },
    stat: { type: 'raw:string', value: 'atk' },
    maxValue: { type: 'raw:number', value: 500 },
    priority: { type: 'raw:number', value: 100 },
  },
}

// Example 10: Complex clamp with observable values using selectAttribute$
export const reactiveClampEffect: EffectDSL = {
  id: 'reactive_clamp',
  trigger: 'OnTurnStart',
  priority: 100,
  apply: {
    type: 'addDynamicAttributeModifier',
    target: { base: 'self' },
    stat: { type: 'raw:string', value: 'def' },
    modifierType: { type: 'raw:string', value: 'clampMax' },
    observableValue: {
      base: 'self',
      chain: [
        { type: 'selectAttribute$', arg: 'atk' },
        { type: 'multiply', arg: { type: 'raw:number', value: 0.8 } },
        { type: 'clampMin', arg: { type: 'raw:number', value: 100 } },
        { type: 'clampMax', arg: { type: 'raw:number', value: 400 } },
      ],
    },
    priority: { type: 'raw:number', value: 100 },
  },
}

// Export all examples for testing
export const clampEffectExamples = {
  attackCapEffect,
  defenseFloorEffect,
  speedRangeEffect,
  levelBasedHPCapEffect,
  emergencyDefenseBoostEffect,
  balancedStatsEffect,
  percentageBasedClampEffect,
  configurableClampEffect,
  teamWideClampEffect,
  reactiveClampEffect,
}
