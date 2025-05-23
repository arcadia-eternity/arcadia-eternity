// 示例技能脚本 - 使用装饰器模式
import { BaseSkill } from '@arcadia-eternity/battle'
import { Category, Element, AttackTargetOpinion, IgnoreStageStrategy } from '@arcadia-eternity/const'
import { RegisterSkill } from '@arcadia-eternity/data-repository'

@RegisterSkill()
export class ExampleSkill extends BaseSkill {
  constructor() {
    super(
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
      IgnoreStageStrategy.none,
      ['script', 'example'], // tags
      [] // effects
    )
  }
}
