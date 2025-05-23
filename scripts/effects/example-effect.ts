// 示例效果脚本 - 使用装饰器模式
import { Effect } from '@arcadia-eternity/battle'
import { EffectTrigger } from '@arcadia-eternity/const'
import { RegisterEffect } from '@arcadia-eternity/data-repository'

@RegisterEffect()
export class ExampleEffect extends Effect<EffectTrigger> {
  constructor() {
    super(
      'example_effect' as any,
      EffectTrigger.OnDamage,
      context => {
        console.log('示例效果被触发:', context)
      },
      0, // priority
      undefined, // condition
      undefined, // consumesStacks
      ['script', 'example'], // tags
    )
  }
}
