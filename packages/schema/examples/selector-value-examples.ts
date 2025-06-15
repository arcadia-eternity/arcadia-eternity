import type { EffectDSL, SelectorValue } from '../src/effectDsl'

// 示例1: 从数值创建selector
const numberSelectorExample: SelectorValue = {
  type: 'selector',
  value: 100,
  chain: [
    { type: 'add', arg: 50 },
    { type: 'multiply', arg: 2 }
  ]
}

// 示例2: 从数组创建selector
const arraySelectorExample: SelectorValue = {
  type: 'selector',
  value: [10, 20, 30, 40, 50],
  chain: [
    { type: 'randomPick', arg: 3 },
    { type: 'sum' }
  ]
}

// 示例3: 从配置值创建selector
const configSelectorExample: SelectorValue = {
  type: 'selector',
  value: {
    type: 'raw:number',
    value: 75,
    configId: 'base_damage',
    tags: ['damage', 'configurable']
  },
  chain: [
    { type: 'multiply', arg: 1.5 },
    { type: 'clampMax', arg: 200 }
  ]
}

// 示例4: 从动态值创建selector
const dynamicSelectorExample: SelectorValue = {
  type: 'selector',
  value: {
    type: 'dynamic',
    selector: {
      base: 'self',
      chain: [
        { type: 'selectPath', arg: 'currentHp' }
      ]
    }
  },
  chain: [
    { type: 'divide', arg: 10 },
    { type: 'clampMin', arg: 5 }
  ]
}

// 示例5: 从条件值创建selector
const conditionalSelectorExample: SelectorValue = {
  type: 'selector',
  value: {
    type: 'conditional',
    condition: {
      type: 'evaluate',
      target: {
        base: 'self',
        chain: [{ type: 'selectPath', arg: 'currentHp' }]
      },
      evaluator: {
        type: 'compare',
        operator: '>',
        value: 50
      }
    },
    trueValue: 100,
    falseValue: 25
  },
  chain: [
    { type: 'multiply', arg: 2 }
  ]
}

// 完整的效果示例1: HP比例伤害
const hpScalingDamageEffect: EffectDSL = {
  id: 'hp_scaling_damage',
  trigger: 'OnDealDamage',
  priority: 100,
  apply: {
    type: 'dealDamage',
    target: 'target',
    value: {
      type: 'selector',
      value: {
        type: 'dynamic',
        selector: {
          base: 'self',
          chain: [{ type: 'selectPath', arg: 'currentHp' }]
        }
      },
      chain: [
        { type: 'divide', arg: 5 },
        { type: 'add', arg: 30 },
        { type: 'clampMax', arg: 150 }
      ]
    }
  }
}

// 完整的效果示例2: 随机治疗
const randomHealEffect: EffectDSL = {
  id: 'random_heal',
  trigger: 'OnTurnStart',
  priority: 50,
  apply: {
    type: 'heal',
    target: 'selfTeam',
    value: {
      type: 'selector',
      value: [15, 25, 35, 45],
      chain: [
        { type: 'randomPick', arg: 1 }
      ]
    }
  }
}

// 完整的效果示例3: 条件属性修改
const conditionalAttributeModifierEffect: EffectDSL = {
  id: 'conditional_atk_boost',
  trigger: 'OnTurnStart',
  priority: 75,
  apply: {
    type: 'addAttributeModifier',
    target: 'self',
    stat: 'atk',
    modifierType: 'percent',
    value: {
      type: 'selector',
      value: {
        type: 'conditional',
        condition: {
          type: 'evaluate',
          target: {
            base: 'self',
            chain: [{ type: 'selectPath', arg: 'currentHp' }]
          },
          evaluator: {
            type: 'compare',
            operator: '<',
            value: 30
          }
        },
        trueValue: 50,  // 低血量时+50%攻击
        falseValue: 20  // 正常时+20%攻击
      }
    }
  }
}

// 完整的效果示例4: 多层数值计算
const complexCalculationEffect: EffectDSL = {
  id: 'complex_damage_calculation',
  trigger: 'OnDealDamage',
  priority: 100,
  apply: {
    type: 'dealDamage',
    target: 'target',
    value: {
      type: 'selector',
      value: [
        {
          type: 'dynamic',
          selector: {
            base: 'self',
            chain: [{ type: 'selectPath', arg: 'stat.atk' }]
          }
        },
        {
          type: 'raw:number',
          value: 50,
          configId: 'base_power'
        }
      ],
      chain: [
        { type: 'sum' },
        { type: 'multiply', arg: 1.2 },
        { type: 'clampMin', arg: 10 },
        { type: 'clampMax', arg: 300 }
      ]
    }
  }
}

export {
  numberSelectorExample,
  arraySelectorExample,
  configSelectorExample,
  dynamicSelectorExample,
  conditionalSelectorExample,
  hpScalingDamageEffect,
  randomHealEffect,
  conditionalAttributeModifierEffect,
  complexCalculationEffect
}
