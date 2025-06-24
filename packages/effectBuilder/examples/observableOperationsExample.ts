// Example: Using Observable numerical operations with selectors
import { BaseSelector } from '../src/selector'

// Example 1: Basic Observable arithmetic operations
export const ObservableArithmeticExamples = {
  // 基础加法：HP + 固定值
  addConstant: {
    description: 'Add constant value to HP Observable',
    dsl: {
      base: 'self',
      chain: [
        { type: 'selectAttribute$', arg: 'currentHp' },
        { type: 'add', arg: 50 },
      ],
    },
  },

  // 乘法：攻击力 * 1.5
  multiplyByFactor: {
    description: 'Multiply attack by 1.5',
    dsl: {
      base: 'self',
      chain: [
        { type: 'selectAttribute$', arg: 'atk' },
        { type: 'multiply', arg: 1.5 },
      ],
    },
  },

  // 除法：HP百分比计算
  calculateHpPercentage: {
    description: 'Calculate HP percentage',
    dsl: {
      base: 'self',
      chain: [
        { type: 'selectAttribute$', arg: 'currentHp' },
        { type: 'divide', arg: 100 },
      ],
    },
  },

  // 限制最大值：攻击力不超过999
  clampAttackMax: {
    description: 'Clamp attack to maximum 999',
    dsl: {
      base: 'self',
      chain: [
        { type: 'selectAttribute$', arg: 'atk' },
        { type: 'clampMax', arg: 999 },
      ],
    },
  },

  // 限制最小值：防御力至少为10
  clampDefenseMin: {
    description: 'Clamp defense to minimum 10',
    dsl: {
      base: 'self',
      chain: [
        { type: 'selectAttribute$', arg: 'def' },
        { type: 'clampMin', arg: 10 },
      ],
    },
  },
}

// Example 2: Complex Observable operations for dynamic modifiers
export const DynamicModifierExamples = {
  // HP比例攻击加成：当前HP/最大HP * 100%
  hpRatioAttackBonus: {
    description: 'Attack bonus based on HP ratio',
    effect: {
      id: 'hp_ratio_attack_bonus',
      trigger: 'OnTurnStart',
      priority: 100,
      apply: {
        type: 'addDynamicAttributeModifier',
        target: { base: 'self' },
        stat: 'atk',
        modifierType: 'percent',
        observableValue: {
          base: 'self',
          chain: [
            { type: 'selectAttribute$', arg: 'currentHp' },
            { type: 'divide', arg: 100 }, // 转换为百分比
            { type: 'clampMax', arg: 2.0 }, // 最大200%
            { type: 'clampMin', arg: 0.1 }, // 最小10%
          ],
        },
        priority: 200,
      },
    },
  },

  // 敌方攻击力反制：防御力 = 敌方攻击力 * 0.8
  counterDefenseBonus: {
    description: 'Defense bonus based on enemy attack',
    effect: {
      id: 'counter_defense_bonus',
      trigger: 'OnTurnStart',
      priority: 100,
      apply: {
        type: 'addDynamicAttributeModifier',
        target: { base: 'self' },
        stat: 'def',
        modifierType: 'delta',
        observableValue: {
          base: 'opponent',
          chain: [
            { type: 'selectAttribute$', arg: 'atk' },
            { type: 'multiply', arg: 0.8 },
            { type: 'clampMax', arg: 500 }, // 防止过高
          ],
        },
        priority: 150,
      },
    },
  },

  // 速度基于剩余HP：HP越低速度越快
  lowHpSpeedBoost: {
    description: 'Speed boost when HP is low',
    effect: {
      id: 'low_hp_speed_boost',
      trigger: 'OnTurnStart',
      priority: 100,
      apply: {
        type: 'addDynamicAttributeModifier',
        target: { base: 'self' },
        stat: 'spe',
        modifierType: 'percent',
        observableValue: {
          base: 'self',
          chain: [
            { type: 'selectAttribute$', arg: 'currentHp' },
            { type: 'multiply', arg: -2 }, // 反比关系
            { type: 'add', arg: 200 }, // 基础值200
            { type: 'clampMax', arg: 150 }, // 最大150%加成
            { type: 'clampMin', arg: 0 }, // 最小0%
          ],
        },
        priority: 300,
      },
    },
  },
}

// Example 3: Multi-step Observable transformations
export const ComplexTransformationExamples = {
  // 复杂计算：基于多个属性的综合加成
  multiAttributeBonus: {
    description: 'Complex bonus based on multiple attributes',
    dsl: {
      base: 'self',
      chain: [
        { type: 'selectAttribute$', arg: 'atk' },
        {
          type: 'add',
          arg: {
            base: 'self',
            chain: [
              { type: 'selectAttribute$', arg: 'def' },
              { type: 'multiply', arg: 0.5 },
            ],
          },
        },
        {
          type: 'multiply',
          arg: {
            base: 'self',
            chain: [
              { type: 'selectAttribute$', arg: 'currentHp' },
              { type: 'divide', arg: 100 },
            ],
          },
        },
        { type: 'clampMax', arg: 999 },
      ],
    },
  },

  // 动态阈值：基于敌方属性调整自身属性
  adaptiveThreshold: {
    description: 'Adaptive threshold based on enemy stats',
    effect: {
      id: 'adaptive_threshold',
      trigger: 'OnTurnStart',
      priority: 100,
      apply: {
        type: 'addDynamicAttributeModifier',
        target: { base: 'self' },
        stat: 'spa',
        modifierType: 'override',
        observableValue: {
          base: 'opponent',
          chain: [
            { type: 'selectAttribute$', arg: 'spd' },
            { type: 'multiply', arg: 1.2 },
            {
              type: 'add',
              arg: {
                base: 'self',
                chain: [
                  { type: 'selectAttribute$', arg: 'spa' },
                  { type: 'multiply', arg: 0.3 },
                ],
              },
            },
            { type: 'clampMin', arg: 50 },
            { type: 'clampMax', arg: 300 },
          ],
        },
        priority: 400,
      },
    },
  },
}

// Example 4: Conditional Observable operations
export const ConditionalObservableExamples = {
  // 条件性数值操作
  conditionalBonus: {
    description: 'Conditional bonus based on HP threshold',
    effect: {
      id: 'conditional_bonus',
      trigger: 'OnTurnStart',
      priority: 100,
      apply: {
        type: 'conditional',
        condition: {
          type: 'evaluate',
          target: {
            base: 'self',
            chain: [
              { type: 'selectAttribute$', arg: 'currentHp' },
              { type: 'divide', arg: 100 },
            ],
          },
          evaluator: { type: 'compare', operator: '<', value: 0.5 },
        },
        trueOperator: {
          type: 'addDynamicAttributeModifier',
          target: { base: 'self' },
          stat: 'atk',
          modifierType: 'percent',
          observableValue: {
            base: 'self',
            chain: [
              { type: 'selectAttribute$', arg: 'currentHp' },
              { type: 'multiply', arg: -3 },
              { type: 'add', arg: 250 },
              { type: 'clampMax', arg: 200 },
            ],
          },
          priority: 500,
        },
        falseOperator: {
          type: 'addDynamicAttributeModifier',
          target: { base: 'self' },
          stat: 'def',
          modifierType: 'percent',
          observableValue: {
            base: 'self',
            chain: [
              { type: 'selectAttribute$', arg: 'currentHp' },
              { type: 'divide', arg: 100 },
              { type: 'multiply', arg: 50 },
            ],
          },
          priority: 500,
        },
      },
    },
  },
}

// Usage documentation
export const ObservableOperationsDocumentation = {
  supportedOperations: [
    'add - 加法操作，支持Observable + 常数或Observable + Observable',
    'multiply - 乘法操作，结果向下取整',
    'divide - 除法操作，结果向下取整，自动检查除零错误',
    'sum - 求和操作，将多个Observable合并为一个',
    'clampMax - 最大值限制',
    'clampMin - 最小值限制',
  ],

  typeSupport: [
    'ChainableSelector<number> - 传统数值选择器',
    'ChainableSelector<Observable<number>> - Observable数值选择器',
    '自动类型检测和重载支持',
  ],

  performanceNotes: [
    'Observable操作使用RxJS的map和combineLatest',
    '自动订阅管理和清理',
    '支持复杂的流式计算',
    '运行时类型检查确保安全性',
  ],
}
