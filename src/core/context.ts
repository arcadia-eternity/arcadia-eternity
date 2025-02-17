import { Battle } from './battle'
import { Player } from './player'
import { AttackTargetOpinion, DamageType, MarkOwner } from './const'
import { Mark } from './mark'
import { Pet } from './pet'
import { Skill } from './skill'
import { EffectTrigger } from './effect'

export abstract class Context {
  readonly type: string = 'base'
  public readonly battle?: Battle
  constructor(
    public readonly parent: null | AllContext, //指明该上下文是由哪个上下文或者对象产生的
  ) {}
}

export type AllContext =
  | Battle
  | TurnContext
  | UseSkillContext
  | DamageContext
  | HealContext
  | AddMarkContext
  | RemoveMarkContext
  | SwitchPetContext
  | RageContext
  | EffectContext<EffectTrigger>

export class TurnContext extends Context {
  readonly type = 'turn'
  public readonly battle: Battle
  constructor(public readonly parent: Battle) {
    super(parent)
    this.battle = parent.battle
  }
}

export class UseSkillContext extends Context {
  readonly type = 'use-skill'
  public readonly battle: Battle
  public readonly available: boolean = true
  public skillPriority: number = 0
  public power: number = 0
  public rageCost: number = 0
  actualTarget?: Pet = undefined
  damageModified: [number, number] = [0, 0] // 百分比修正, 固定值修正
  damageResult: number = 0
  minThreshold?: number = undefined // 最小伤害阈值数值
  maxThreshold?: number = undefined // 最大伤害阈值数值
  crit: boolean = false
  sureHit: boolean = false
  multihit: [number, number] | number = 1
  multihitResult = 1

  constructor(
    public readonly parent: TurnContext,
    public origin: Player,
    public pet: Pet,
    public selectTarget: AttackTargetOpinion,
    public skill: Skill,
  ) {
    super(parent)
    this.battle = parent.battle

    if (Array.isArray(this.multihit)) {
      const [low, high] = this.multihit
      this.multihitResult = this.battle.randomInt(low, high)
    } else {
      this.multihitResult = this.multihit
    }
    this.power = this.skill.power
    this.rageCost = this.skill.rage
    this.sureHit = skill.sureHit
  }

  amplifyPower(multiplier: number) {
    this.power *= multiplier
  }

  addPower(value: number) {
    this.power += value
  }

  setThreshold(min?: number, max?: number) {
    if (min) this.minThreshold = min
    if (max) this.maxThreshold = max
  }

  setCrit(crit: boolean) {
    this.crit = crit
  }
}

export class SwitchPetContext extends Context {
  readonly type = 'switch-pet'
  public readonly battle: Battle
  constructor(
    public readonly parent: TurnContext | Battle,
    public origin: Player,
    public target: Pet,
  ) {
    super(parent)
    this.battle = parent.battle!
  }
}

export class RageContext extends Context {
  readonly type = 'rage-cost'
  public readonly battle: Battle
  public readonly available: boolean = true
  constructor(
    public readonly parent: UseSkillContext | EffectContext<EffectTrigger> | TurnContext,
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

export class DamageContext extends Context {
  readonly type = 'damage'
  public readonly battle: Battle
  public readonly available: boolean = true
  constructor(
    public readonly parent: UseSkillContext | EffectContext<EffectTrigger>,
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
  public readonly battle: Battle
  public readonly available: boolean = true
  constructor(
    public readonly parent: EffectContext<EffectTrigger>,
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
  public readonly battle: Battle
  public readonly available: boolean = true
  constructor(
    public readonly parent: EffectContext<EffectTrigger> | SwitchPetContext,
    public target: MarkOwner,
    public mark: Mark,
    public stack?: number,
  ) {
    super(parent)
    this.battle = parent.battle
  }
}

export class RemoveMarkContext extends Context {
  readonly type = 'remove-mark'
  public readonly battle: Battle
  public readonly available: boolean = true
  constructor(
    public readonly parent: EffectContext<EffectTrigger>,
    public target: Pet,
    public mark: Mark,
  ) {
    super(parent)
    this.battle = parent.battle
  }
}

type TriggerContextMap = {
  [EffectTrigger.OnBattleStart]: Battle

  [EffectTrigger.BeforeSort]: UseSkillContext
  [EffectTrigger.BeforeAttack]: UseSkillContext
  [EffectTrigger.PreDamage]: UseSkillContext
  [EffectTrigger.OnCritPreDamage]: UseSkillContext
  [EffectTrigger.OnDamage]: DamageContext
  [EffectTrigger.PostDamage]: DamageContext
  [EffectTrigger.OnCritPostDamage]: UseSkillContext
  [EffectTrigger.OnBeforeHit]: UseSkillContext
  [EffectTrigger.OnHit]: UseSkillContext
  [EffectTrigger.OnMiss]: UseSkillContext
  [EffectTrigger.AfterAttacked]: UseSkillContext
  [EffectTrigger.OnDefeat]: UseSkillContext

  [EffectTrigger.TurnStart]: TurnContext
  [EffectTrigger.TurnEnd]: TurnContext

  [EffectTrigger.OnAddMark]: AddMarkContext
  [EffectTrigger.OnRemoveMark]: RemoveMarkContext
  [EffectTrigger.OnMarkCreate]: AddMarkContext
  [EffectTrigger.OnMarkDestroy]: RemoveMarkContext
  [EffectTrigger.OnMarkDurationEnd]: TurnContext

  [EffectTrigger.OnStack]: EffectContext<EffectTrigger>
  [EffectTrigger.OnHeal]: EffectContext<EffectTrigger>
  [EffectTrigger.OnRageGain]: RageContext
  [EffectTrigger.OnRageLoss]: RageContext

  [EffectTrigger.OnSwitchIn]: SwitchPetContext
  [EffectTrigger.OnSwitchOut]: SwitchPetContext
  [EffectTrigger.OnOwnerSwitchIn]: SwitchPetContext
  [EffectTrigger.OnOwnerSwitchOut]: SwitchPetContext

  [EffectTrigger.BeforeEffect]: AllContext
  [EffectTrigger.AfterEffect]: AllContext
}

export class EffectContext<T extends EffectTrigger> extends Context {
  readonly type = 'effect'
  public readonly battle: Battle
  public readonly available: boolean = true
  constructor(
    public readonly parent: TriggerContextMap[T],
    public readonly trigger: T,
    public readonly source: Skill | Mark,
  ) {
    super(parent)
    this.battle = parent.battle
  }
}
