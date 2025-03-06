import { AttackTargetOpinion, DamageType } from '@test-battle/const/const'
import { EffectTrigger } from '@test-battle/const/effectTrigger'
import { Battle } from './battle'
import { type MarkOwner } from './entity'
import { BaseMark, MarkInstance } from './mark'
import { Pet } from './pet'
import { Player } from './player'
import { SkillInstance } from './skill'
import { Category, ELEMENT_CHART, type Element } from '@test-battle/const'

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

  priority: number

  category: Category
  element: Element
  power: number = 0
  accuracy: number = 100
  rage: number = 0

  hitOverrides: {
    willHit: boolean
    priority: number
  }[] = []

  critOverrides: {
    willCrit: boolean
    priority: number
  }[] = []

  ignoreShield = false
  multihit: [number, number] | number = 1

  available: boolean = true

  damageModified: [number, number] = [0, 0] // 百分比修正, 固定值修正
  minThreshold: number = 0 // 最小伤害阈值数值
  maxThreshold: number = Number.MAX_SAFE_INTEGER // 最大伤害阈值数值

  actualTarget?: Pet = undefined
  hitResult: boolean = false
  crit: boolean = false
  multihitResult = 1

  damageType: DamageType = DamageType.physical
  typeMultiplier = 1
  stabMultiplier = 1.5
  critMultiplier = 1

  damageResult: number = 0

  constructor(
    public readonly parent: TurnContext,
    public origin: Player,
    public pet: Pet,
    public selectTarget: AttackTargetOpinion,
    public skill: SkillInstance,
  ) {
    super(parent)
    this.battle = parent.battle

    this.priority = skill.priority
    this.category = skill.category
    this.element = skill.element
    this.multihit = skill.multihit
    this.power = skill.power
    this.accuracy = skill.accuracy
    this.rage = skill.rage
    if (skill.sureHit)
      this.hitOverrides.push({
        willHit: true,
        priority: 0,
      })
    this.ignoreShield = skill.ignoreShield
  }

  updateActualTarget() {
    this.actualTarget =
      this.skill.target === AttackTargetOpinion.opponent ? this.battle!.getOpponent(this.origin).activePet : this.pet // 动态获取当前目标
  }

  updateMultihitResult() {
    if (Array.isArray(this.multihit)) {
      const [low, high] = this.multihit
      this.multihitResult = this.battle.randomInt(low, high)
    } else {
      this.multihitResult = this.multihit
    }
  }

  //以下都是取最大优先级的结果
  updateHitResult() {
    if (this.hitOverrides.length > 0)
      this.hitResult = this.hitOverrides.reduce((a, b) => (a.priority > b.priority ? a : b)).willHit
    else this.hitResult = this.battle!.random() > this.skill.accuracy
  }

  updateCritResult() {
    if (this.critOverrides.length > 0) this.critOverrides.reduce((a, b) => (a.priority > b.priority ? a : b)).willCrit
    else this.crit = this.battle.random() < this.pet.stat.critRate
  }

  setSkill(skill: SkillInstance, updateConfig?: boolean) {
    this.skill = skill
    if (updateConfig) {
      this.power = skill.power
      this.rage = skill.rage
      if (skill.sureHit)
        this.hitOverrides.push({
          willHit: true,
          priority: 0,
        })
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

  updateDamageResult() {
    if (!this.actualTarget) return
    this.typeMultiplier = ELEMENT_CHART[this.skill.element][this.actualTarget.element] || 1
    let atk = 0
    let def = 0
    switch (this.category) {
      case Category.Physical:
        atk = this.pet.actualStat.atk
        def = this.actualTarget.actualStat.def
        this.damageType = DamageType.physical
        break
      case Category.Special:
        atk = this.pet.actualStat.spa
        def = this.actualTarget.actualStat.spd
        this.damageType = DamageType.special
        break
      case Category.Climax:
        if (this.pet.actualStat.atk > this.pet.actualStat.spa) {
          atk = this.pet.actualStat.atk
          def = this.actualTarget.actualStat.def
          this.damageType = DamageType.physical
        } else {
          atk = this.pet.actualStat.spa
          def = this.actualTarget.actualStat.spd
          this.damageType = DamageType.special
        }
    }
    const baseDamage = Math.floor((((2 * this.actualTarget.level) / 5 + 2) * this.power * (atk / def)) / 50 + 2)

    // 随机波动
    const randomFactor = this.battle!.random() * 0.15 + 0.85

    // STAB加成
    this.stabMultiplier = this.pet.species.element === this.skill.element ? 1.5 : 1

    // 暴击加成
    this.critMultiplier = this.crit ? 2 : 1

    // 应用百分比修正（叠加计算）
    const percentModifier = 1 + this.damageModified[0] / 100

    // 计算中间伤害
    let intermediateDamage = Math.floor(
      baseDamage * randomFactor * this.typeMultiplier * this.stabMultiplier * this.critMultiplier * percentModifier,
    )

    // 应用固定值修正
    intermediateDamage += this.damageModified[1]

    // 应用伤害阈值（先处理最小值再处理最大值）
    // 最小值阈值处理
    if (this.minThreshold) {
      intermediateDamage = Math.min(intermediateDamage, this.minThreshold)
    }

    // 最大值阈值处理
    if (this.maxThreshold) {
      intermediateDamage = Math.max(intermediateDamage, this.maxThreshold)
    }

    // 记录最终伤害
    this.damageResult = Math.max(0, intermediateDamage)
  }

  setThreshold(min?: number, max?: number) {
    if (min) this.minThreshold = min
    if (max) this.maxThreshold = max
  }

  setCrit(crit: boolean) {
    this.crit = crit
  }

  setSureHit(priority = 0) {
    this.hitOverrides.push({
      willHit: true,
      priority: priority,
    })
  }

  setSureCrit(priority = 0) {
    this.critOverrides.push({
      willCrit: true,
      priority,
    })
  }

  setSureMiss(priority = -1) {
    this.hitOverrides.push({
      willHit: false,
      priority: priority,
    })
  }

  setSureNoCrit(priority = -1) {
    this.critOverrides.push({
      willCrit: false,
      priority,
    })
  }

  setActualTarget(target: Pet) {
    this.actualTarget = target
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
  public available: boolean = true
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
  [EffectTrigger.BeforeUseSkillCheck]: UseSkillContext
  [EffectTrigger.AfterUseSkillCheck]: UseSkillContext
  [EffectTrigger.PreDamage]: UseSkillContext
  [EffectTrigger.OnCritPreDamage]: UseSkillContext
  [EffectTrigger.BeforeHit]: UseSkillContext
  [EffectTrigger.OnHit]: UseSkillContext
  [EffectTrigger.OnMiss]: UseSkillContext
  [EffectTrigger.AfterAttacked]: UseSkillContext
  [EffectTrigger.OnDefeat]: UseSkillContext

  [EffectTrigger.OnDamage]: DamageContext
  [EffectTrigger.Shield]: DamageContext
  [EffectTrigger.PostDamage]: DamageContext
  [EffectTrigger.OnCritPostDamage]: DamageContext

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
