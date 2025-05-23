// 示例效果脚本 - 使用函数式API
import { Effect } from '@arcadia-eternity/battle'
import { EffectTrigger } from '@arcadia-eternity/const'
import { declareEffect } from '@arcadia-eternity/data-repository'

// 创建效果实例
const exampleFunctionalEffect = new Effect(
  'example_functional_effect',
  EffectTrigger.OnDamage,
  context => {
    console.log('函数式示例效果被触发:', context)
  },
  0, // priority
  undefined, // condition
  undefined, // consumesStacks
  ['script', 'functional', 'example'], // tags
)

// 使用函数式API声明
declareEffect(exampleFunctionalEffect)
