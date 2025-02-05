import { BattleSystem } from './battleSystem'
import { Player } from './player'
import { AttackTargetOpinion } from './const'
import { Mark } from './mark'
import { Pet } from './pet'
import { Skill } from './skill'

export class Context {
  readonly type: string = 'base'
  constructor(
    public readonly battle: BattleSystem,
    public readonly parent:
      | null
      | BattleSystem
      | TurnContext
      | UseSkillContext
      | SwitchPetContext
      | EffectContext
      | DamageContext
      | HealContext
      | AddMarkContext
      | Pet
      | Player
      | Mark, //指明该上下文是由哪个上下文或者对象产生的
  ) {}
}

export class TurnContext extends Context {
  readonly type = 'turn'
  constructor(
    public readonly battle: BattleSystem,
    public readonly parent: BattleSystem,
  ) {
    super(battle, parent)
  }
}

export class UseSkillContext extends Context {
  readonly type = 'use-skill'
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
    public readonly battleSystem: BattleSystem,
    public readonly parent: TurnContext,
    public pet: Pet,
    public player: Player,
    public selectTarget: AttackTargetOpinion,
    public skill: Skill,
  ) {
    super(battleSystem, parent)
    this.actualTarget = undefined
    this.useSkillSuccess = false
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
  constructor(
    public readonly battleSystem: BattleSystem,
    public readonly parent: TurnContext | Player,
    public player: Player,
    public target: Pet,
  ) {
    super(battleSystem, parent)
  }
}

export class RageContext extends Context {
  readonly type = 'rage-cost'
  constructor(
    public readonly battleSystem: BattleSystem,
    public readonly parent: UseSkillContext | EffectContext | TurnContext,
    public target: Player,
    public reason: 'turn' | 'damage' | 'skill' | 'skillHit' | 'switch',
    public modifiedType: 'setting' | 'add' | 'reduce',
    public value: number,
    public ignoreRageObtainEfficiency: boolean = false,
  ) {
    super(battleSystem, parent)
  }
}

export class EffectContext extends Context {
  readonly type = 'effect'
  constructor(
    public readonly battle: BattleSystem,
    public readonly parent: UseSkillContext | EffectContext | DamageContext | HealContext | AddMarkContext,
    public readonly owner: Pet,
  ) {
    super(battle, parent)
  }
}

export class DamageContext extends Context {
  readonly type = 'damage'
  constructor(
    public readonly battle: BattleSystem,
    public readonly parent: UseSkillContext | EffectContext,
    public value: number,
    public ingoreShield: boolean = false,
  ) {
    super(battle, parent)
  }
}

export class HealContext extends Context {
  readonly type = 'heal'
  constructor(
    public readonly battle: BattleSystem,
    public readonly parent: EffectContext,
    public target: Pet,
    public value: number,
    public ingoreEffect: boolean = false,
  ) {
    super(battle, parent)
  }
}

export class AddMarkContext extends Context {
  readonly type = 'add-mark'
  constructor(
    public readonly battle: BattleSystem,
    public readonly parent: EffectContext,
    public target: Pet,
    public mark: Mark,
  ) {
    super(battle, parent)
  }
}

export class RemoveMarkContext extends Context {
  readonly type = 'remove-mark'
  constructor(
    public readonly battle: BattleSystem,
    public readonly parent: EffectContext,
    public target: Pet,
    public mark: Mark,
  ) {
    super(battle, parent)
  }
}
