import { AttackTargetOpinion, DamageType } from '@test-battle/const/const'
import { EffectTrigger } from '@test-battle/const/effectTrigger'
import { Battle } from './battle'
import { type MarkOwner } from './entity'
import { BaseMark, MarkInstance } from './mark'
import { Pet } from './pet'
import { Player } from './player'
import { SkillInstance } from './skill'

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
  public available: boolean = true
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
  ignoreShield = false

  constructor(
    public readonly parent: TurnContext,
    public origin: Player,
    public pet: Pet,
    public selectTarget: AttackTargetOpinion,
    public skill: SkillInstance,
  ) {
    super(parent)
    this.battle = parent.battle

    this.multihit = skill.multihit
    this.power = this.skill.power
    this.rageCost = this.skill.rage
    this.sureHit = skill.sureHit
    this.ignoreShield = skill.ignoreShield
    this.updateMultihitResult()
  }

  updateMultihitResult() {
    if (Array.isArray(this.multihit)) {
      const [low, high] = this.multihit
      this.multihitResult = this.battle.randomInt(low, high)
    } else {
      this.multihitResult = this.multihit
    }
  }

  setSkill(skill: SkillInstance, updateConfig?: boolean) {
    this.skill = skill
    if (updateConfig) {
      this.power = skill.power
      this.rageCost = skill.rage
      this.sureHit = skill.sureHit
      this.multihit = skill.multihit
      this.ignoreShield = skill.ignoreShield
    }
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

  setSureHit(sureHit: boolean) {
    this.sureHit = sureHit
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
    public readonly source: Pet | MarkInstance | SkillInstance, //来自技能伤害，还是印记和技能的效果获得的伤害
    public readonly target: Pet,
    public value: number,
    public damageType: DamageType = DamageType.effect,
    public crit: boolean = false,
    public effectiveness: number = 1,
    public ignoreShield: boolean = false,
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
    public readonly source: MarkInstance | SkillInstance,
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
    public mark: BaseMark,
    public stack?: number,
    public duration?: number,
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
    public mark: MarkInstance,
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
  [EffectTrigger.Shield]: DamageContext
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
    public readonly source: SkillInstance | MarkInstance,
  ) {
    super(parent)
    this.battle = parent.battle
  }
}
