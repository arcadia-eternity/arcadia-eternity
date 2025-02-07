import { BattleSystem } from './battleSystem'
import { Player } from './player'
import { AttackTargetOpinion, DamageType } from './const'
import { Mark } from './mark'
import { Pet } from './pet'
import { Skill } from './skill'

export abstract class Context {
  readonly type: string = 'base'
  public readonly battle?: BattleSystem
  constructor(
    public readonly parent: null | AllContext, //指明该上下文是由哪个上下文或者对象产生的
  ) {}
}

export type AllContext =
  | BattleSystem
  | TurnContext
  | UseSkillContext
  | SwitchPetContext
  | EffectContext
  | DamageContext
  | HealContext
  | AddMarkContext

export class TurnContext extends Context {
  readonly type = 'turn'
  public readonly battle: BattleSystem
  constructor(public readonly parent: BattleSystem) {
    super(parent)
    this.battle = parent.battle
  }
}

export class UseSkillContext extends Context {
  readonly type = 'use-skill'
  public readonly battle: BattleSystem
  public skillPriority: number
  public power: number
  public rageCost: number
  actualTarget?: Pet
  useSkillSuccess: boolean
  damageModified: [number, number] // 百分比修正, 固定值修正
  damageResult: number
  minThreshold?: number // 最小伤害阈值数值
  maxThreshold?: number // 最大伤害阈值数值
  crit: boolean
  sureHit: boolean
  constructor(
    public readonly parent: TurnContext,
    public origin: Player,
    public pet: Pet,
    public selectTarget: AttackTargetOpinion,
    public skill: Skill,
  ) {
    super(parent)
    this.battle = parent.battle
    this.actualTarget = undefined
    this.useSkillSuccess = true
    this.damageModified = [0, 0]
    this.damageResult = 0
    this.minThreshold = undefined
    this.maxThreshold = undefined
    this.crit = false
    this.sureHit = false
    this.skillPriority = 0
    this.power = 0
    this.rageCost = 0
  }
}

export class SwitchPetContext extends Context {
  readonly type = 'switch-pet'
  public readonly battle: BattleSystem
  constructor(
    public readonly parent: TurnContext | BattleSystem,
    public origin: Player,
    public target: Pet,
  ) {
    super(parent)
    this.battle = parent.battle!
  }
}

export class RageContext extends Context {
  readonly type = 'rage-cost'
  public readonly battle: BattleSystem
  constructor(
    public readonly parent: UseSkillContext | EffectContext | TurnContext,
    public target: Player,
    public reason: 'turn' | 'damage' | 'skill' | 'skillHit' | 'switch' | 'effect',
    public modifiedType: 'setting' | 'add' | 'reduce',
    public value: number,
    public ignoreRageObtainEfficiency: boolean = false,
  ) {
    super(parent)
    this.battle = parent.battle
  }
}

export class EffectContext extends Context {
  readonly type = 'effect'
  public readonly battle: BattleSystem
  constructor(
    public readonly parent: AllContext,
    public readonly source: Skill | Mark,
  ) {
    super(parent)
    this.battle = parent.battle
  }
}

export class DamageContext extends Context {
  readonly type = 'damage'
  public readonly battle: BattleSystem
  constructor(
    public readonly parent: UseSkillContext | EffectContext,
    public readonly source: Pet | Mark | Skill, //来自技能伤害，还是印记和技能的效果获得的伤害
    public value: number,

    //不涉及逻辑仅用于显示
    public damageType: DamageType = DamageType.effect,
    public crit: boolean = false,
    public effectiveness: number = 1,
  ) {
    super(parent)
    this.battle = parent.battle
  }
}

export class HealContext extends Context {
  readonly type = 'heal'
  public readonly battle: BattleSystem
  constructor(
    public readonly parent: EffectContext,
    public readonly source: Mark | Skill,
    public value: number,
    public ingoreEffect: boolean = false,
  ) {
    super(parent)
    this.battle = parent.battle
  }
}

export class AddMarkContext extends Context {
  readonly type = 'add-mark'
  public readonly battle: BattleSystem
  constructor(
    public readonly parent: EffectContext,
    public target: Pet,
    public mark: Mark,
  ) {
    super(parent)
    this.battle = parent.battle
  }
}

export class RemoveMarkContext extends Context {
  readonly type = 'remove-mark'
  public readonly battle: BattleSystem
  constructor(
    public readonly parent: EffectContext,
    public target: Pet,
    public mark: Mark,
  ) {
    super(parent)
    this.battle = parent.battle
  }
}
