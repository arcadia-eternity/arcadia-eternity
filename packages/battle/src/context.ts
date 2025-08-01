import {
  AttackTargetOpinion,
  Category,
  DamageType,
  EffectTrigger,
  ELEMENT_CHART,
  IgnoreStageStrategy,
  StackStrategy,
  type Element,
  type StatOnBattle,
  type petId,
  type skillId,
  type markId,
  type effectId,
  type speciesId,
  type baseSkillId,
  type baseMarkId,
} from '@arcadia-eternity/const'
import { Battle } from './battle'
import { type MarkOwner } from './entity'
import { BaseMark, type MarkInstance } from './mark'
import { Pet } from './pet'
import { Player } from './player'
import { SkillInstance } from './skill'
import type { Effect } from './effect'
import { createChildLogger } from './logger'

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
  | StackContext
  | ConsumeStackContext
  | TransformContext
  | EffectContext<EffectTrigger>

export type PetTurnData = {}
export class TurnContext extends Context {
  readonly type = 'turn'
  public readonly battle: Battle
  public readonly contexts: Context[] = []
  public contextQueue: Context[] = []
  public readonly appledContexts: Context[] = []
  public readonly petTurnDataMap: WeakMap<Pet, PetTurnData> = new WeakMap()

  constructor(public readonly parent: Battle) {
    super(parent)
    this.battle = parent.battle
  }

  private getExecutionOrder(a: Context, b: Context): number {
    // 类型优先级：换宠 > 使用技能
    const typeOrder: Record<Context['type'], number> = {
      'switch-pet': 0, // 换宠优先级最高
      'use-skill': 1,
    }

    // 获取类型顺序值
    const aType = a.type
    const bType = b.type

    // 类型不同时按优先级排序
    if (aType !== bType) {
      return typeOrder[aType] - typeOrder[bType]
    }

    // 同类型时比较优先级
    switch (aType) {
      case 'switch-pet':
        // 换宠之间没有优先级差异，保持原顺序
        return 0

      case 'use-skill': {
        const aSkill = a as UseSkillContext
        const bSkill = b as UseSkillContext

        // 先比较技能优先级（优先级高的先执行，所以是降序）
        if (aSkill.priority !== bSkill.priority) {
          return bSkill.priority - aSkill.priority
        }

        // 同优先级比较速度（速度快的先执行，所以是降序）
        if (aSkill.pet.actualStat.spe !== bSkill.pet.actualStat.spe) {
          return bSkill.pet.actualStat.spe - aSkill.pet.actualStat.spe
        }

        // 速度相同，保持原顺序
        return 0
      }
      default:
        return 0
    }
  }

  pushContext(context: Context) {
    this.contexts.push(context)
    // 按执行顺序排序，然后反转，使得contexts[0]是最后执行的
    this.contexts.sort(this.getExecutionOrder)
    this.contexts.reverse()
  }
}

export class UseSkillContext extends Context {
  readonly type = 'use-skill'
  public readonly battle: Battle
  private readonly logger = createChildLogger('UseSkillContext')

  priority: number

  category: Category
  element: Element
  power: number = 0
  accuracy: number = 100
  petAccuracy: number = 100
  rage: number = 0
  evasion: number = 0
  critRate: number = 7
  ignoreShield = false
  ignoreStageStrategy: IgnoreStageStrategy = IgnoreStageStrategy.none

  hitOverrides: {
    willHit: boolean
    priority: number
  }[] = []

  critOverrides: {
    willCrit: boolean
    priority: number
  }[] = []

  multihit: [number, number] | number = 1

  available: boolean = true

  actualTarget?: Pet = undefined
  hitResult: boolean = false
  crit: boolean = false
  multihitResult = 1

  damageType: DamageType = DamageType.Physical
  typeMultiplier = 1
  stabMultiplier = 1.5
  critMultiplier = 2

  baseDamage: number = 0
  randomFactor: number = 1

  defeated: boolean = false

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
    this.petAccuracy = skill.owner?.stat.accuracy || 100
    this.rage = skill.rage
    this.critRate = pet.stat.critRate
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
    this.evasion = this.actualTarget?.stat.evasion || 0
  }

  updateMultihitResult() {
    if (Array.isArray(this.multihit)) {
      const [low, high] = this.multihit
      this.multihitResult = this.battle.randomInt(low, high)
    } else {
      this.multihitResult = this.multihit
    }
  }

  updateHitResult() {
    if (this.hitOverrides.length > 0)
      this.hitResult = this.hitOverrides.reduce((a, b) => (a.priority > b.priority ? a : b)).willHit
    else if (this.actualTarget === this.skill.owner)
      this.hitResult = this.battle!.random() <= (this.accuracy / 100) * (this.petAccuracy / 100)
    else
      this.hitResult =
        this.battle!.random() <= (this.accuracy / 100) * (this.petAccuracy / 100) * ((100 - this.evasion) / 100)
  }

  updateCritResult() {
    if (this.critOverrides.length > 0)
      this.crit = this.critOverrides.reduce((a, b) => (a.priority > b.priority ? a : b)).willCrit
    else this.crit = this.battle.random() * 100 < this.critRate
  }

  updateDamageResult() {
    if (!this.actualTarget) return
    let atk = 0
    let def = 0
    switch (this.category) {
      case Category.Physical:
        atk = this.pet.actualStat.atk
        def = this.actualTarget.getEffectiveStat(false, this.ignoreStageStrategy).def
        this.damageType = DamageType.Physical
        break
      case Category.Special:
        atk = this.pet.actualStat.spa
        def = this.actualTarget.getEffectiveStat(false, this.ignoreStageStrategy).spd
        this.damageType = DamageType.Special
        break
      case Category.Climax:
        if (this.pet.actualStat.atk > this.pet.actualStat.spa) {
          atk = this.pet.actualStat.atk
          def = this.actualTarget.getEffectiveStat(false, this.ignoreStageStrategy).def
          this.damageType = DamageType.Physical
        } else {
          atk = this.pet.actualStat.spa
          def = this.actualTarget.getEffectiveStat(false, this.ignoreStageStrategy).spd
          this.damageType = DamageType.Special
        }
    }

    const typeMultiplierValue = ELEMENT_CHART[this.skill.element][this.actualTarget.element]
    this.typeMultiplier = typeMultiplierValue === undefined ? 1 : typeMultiplierValue

    const baseDamage = Math.floor((((2 * this.actualTarget.level) / 5 + 2) * this.power * (atk / def)) / 50 + 2)

    // STAB加成
    const stabMultiplier = this.pet.species.element === this.skill.element ? this.stabMultiplier : 1

    // 暴击加成
    const critMultiplier = this.crit ? this.critMultiplier : 1

    // 得到基础伤害
    this.baseDamage = Math.floor(baseDamage * this.typeMultiplier * stabMultiplier * critMultiplier)

    // 随机波动
    this.randomFactor = this.battle!.random() * 0.15 + 0.85
  }

  setSkill(skill: SkillInstance, updateConfig?: boolean) {
    this.skill = skill
    if (updateConfig) {
      this.power = skill.power
      this.rage = skill.rage
      this.category = skill.category
      this.element = skill.element
      this.accuracy = skill.accuracy
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

  addAccuracy(value: number) {
    this.accuracy = Math.max(0, Math.min(this.accuracy + value, 100))
  }

  setAccuracy(accuracy: number) {
    this.accuracy = Math.max(0, Math.min(accuracy, 100))
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

  addCritRate(delta: number) {
    this.critRate = Math.max(0, Math.min(this.critRate + delta, 100))
  }

  addMultihitResult(delta: number) {
    this.multihitResult += delta
  }

  setIgnoreStageStrategy(strategy: IgnoreStageStrategy) {
    this.ignoreStageStrategy = strategy
  }
}

export class SwitchPetContext extends Context {
  readonly type = 'switch-pet'
  public readonly battle: Battle
  public switchOutPet: Pet | null = null // 被换出的宠物
  constructor(
    public readonly parent: TurnContext | Battle,
    public origin: Player,
    public switchInPet: Pet,
  ) {
    super(parent)
    this.battle = parent.battle!
    this.switchOutPet = this.origin.activePet
  }
}

export class RageContext extends Context {
  readonly type = 'rage-cost'
  public readonly battle: Battle
  public available: boolean = true
  public rageChangeResult = 0
  constructor(
    public readonly parent: UseSkillContext | EffectContext<EffectTrigger> | TurnContext,
    public target: Player,
    public reason: 'turn' | 'damage' | 'skill' | 'skillHit' | 'switch' | 'effect',
    public modifiedType: 'setting' | 'add' | 'reduce',
    public value: number,
    public ignoreRageObtainEfficiency: boolean = false,
    public modified: [number, number] = [0, 0],
  ) {
    super(parent)
    this.battle = parent.battle
  }

  updateRageChangeResult() {
    const percentModifier = 1 + this.modified[0] / 100
    const deltaModifier = this.modified[1]
    this.rageChangeResult = Math.floor(this.value * percentModifier + deltaModifier)
  }

  addModified: (percent: number, delta: number) => void = (percent, delta) => {
    this.modified[0] += percent
    this.modified[1] += delta
  }
}

export class DamageContext extends Context {
  readonly type = 'damage'
  public readonly battle: Battle
  public available: boolean = true
  public damageResult: number = 0
  constructor(
    public readonly parent: UseSkillContext | EffectContext<EffectTrigger>,
    public readonly source: MarkInstance | SkillInstance, //来自技能伤害，还是印记和技能的效果获得的伤害
    public readonly target: Pet,
    public baseDamage: number,
    public damageType: DamageType = DamageType.Effect,
    public crit: boolean = false, //显示这个伤害是不是一个暴击伤害，尝试修改他是不会修改实际的伤害数值的
    public effectiveness: number = 1,
    public ignoreShield: boolean = false,
    public randomFactor: number = 1,
    public modified: [number, number] = [0, 0], // 百分比修正, 固定值修正
    public minThreshold: number = 0, // 最小伤害阈值数值
    public maxThreshold: number = Number.MAX_SAFE_INTEGER, // 最大伤害阈值数值
    public element?: Element, // 伤害的元素属性
  ) {
    super(parent)
    this.battle = parent.battle
  }

  updateDamageResult() {
    // 应用百分比修正（叠加计算）
    const percentModifier = 1 + this.modified[0] / 100
    const deltaModifier = this.modified[1]
    let intermediateDamage = this.baseDamage * this.randomFactor * percentModifier + deltaModifier

    // 应用伤害阈值（先处理最小值再处理最大值）
    // 最小值阈值处理
    if (typeof this.minThreshold === 'number') {
      intermediateDamage = Math.max(intermediateDamage, this.minThreshold)
    }

    // 最大值阈值处理
    if (typeof this.maxThreshold === 'number') {
      intermediateDamage = Math.min(intermediateDamage, this.maxThreshold)
    }

    // 记录最终伤害
    this.damageResult = Math.floor(Math.max(0, intermediateDamage))
  }

  addModified: (percent: number, delta: number) => void = (percent, delta) => {
    this.modified[0] += percent
    this.modified[1] += delta
  }

  addThreshold(min?: number, max?: number) {
    if (typeof min === 'number') this.minThreshold = min
    if (typeof max === 'number') this.maxThreshold = max
  }
}

export class HealContext extends Context {
  readonly type = 'heal'
  public readonly battle: Battle
  public available: boolean = true
  public healResult: number = 0
  constructor(
    public readonly parent: EffectContext<EffectTrigger>,
    public readonly source: MarkInstance | SkillInstance,
    public readonly target: Pet,
    public baseHeal: number,
    public ingoreEffect: boolean = false,
    public modified: [number, number] = [0, 0], // 百分比修正, 固定值修正
  ) {
    super(parent)
    this.battle = parent.battle
    this.healResult = baseHeal
  }

  updateHealResult() {
    // 应用百分比修正（叠加计算）
    const percentModifier = 1 + this.modified[0] / 100
    const deltaModifier = this.modified[1]
    let intermediateHeal = this.baseHeal * percentModifier + deltaModifier

    // 记录最终治疗值
    this.healResult = Math.floor(Math.max(0, intermediateHeal))
  }

  addModified: (percent: number, delta: number) => void = (percent, delta) => {
    this.modified[0] += percent
    this.modified[1] += delta
  }

  // For backward compatibility
  get value(): number {
    return this.healResult
  }

  set value(val: number) {
    this.healResult = val
  }
}

export class AddMarkContext extends Context {
  readonly type = 'add-mark'
  public readonly battle: Battle
  public available: boolean = true
  public stack: number
  public duration: number
  constructor(
    public readonly parent: EffectContext<EffectTrigger>,
    public target: MarkOwner,
    public baseMark: BaseMark,
    stack?: number,
    duration?: number,
    public config?: Partial<MarkInstance['config']>,
  ) {
    super(parent)
    this.battle = parent.battle
    //拷贝，因为原值是只读的
    if (!config) this.config = JSON.parse(JSON.stringify(baseMark.config))
    this.duration = duration ?? config?.duration ?? baseMark.config.duration
    this.stack = stack ?? config?.maxStacks ?? baseMark.config.maxStacks
  }

  overrideConfig(overrideConfig: Partial<MarkInstance['config']>) {
    this.config = {
      ...this.config,
      ...overrideConfig,
    }
  }

  setDuration(duration: number) {
    this.duration = duration
  }

  setStack(stack: number) {
    this.stack = stack
  }

  setMaxStack(stack: number) {
    if (!this.config) this.config = {}
    this.config.maxStacks = stack
  }

  setPersistent(persistent: boolean) {
    if (!this.config) this.config = {}
    this.config.persistent = persistent
  }

  setStackable(stackable: boolean) {
    if (!this.config) this.config = {}
    this.config.stackable = stackable
  }

  setStackStrategy(stackStrategy: StackStrategy) {
    if (!this.config) this.config = {}
    this.config.stackStrategy = stackStrategy
  }

  setDestroyable(destroyable: boolean) {
    if (!this.config) this.config = {}
    this.config.destroyable = destroyable
  }

  setIsShield(isShield: boolean) {
    if (!this.config) this.config = {}
    this.config.isShield = isShield
  }

  setKeepOnSwitchOut(keepOnSwitchOut: boolean) {
    if (!this.config) this.config = {}
    this.config.keepOnSwitchOut = keepOnSwitchOut
  }

  setTransferOnSwitch(transferOnSwitch: boolean) {
    if (!this.config) this.config = {}
    this.config.transferOnSwitch = transferOnSwitch
  }

  setInheritOnFaint(inheritOnFaint: boolean) {
    if (!this.config) this.config = {}
    this.config.inheritOnFaint = inheritOnFaint
  }
}

export class RemoveMarkContext extends Context {
  readonly type = 'remove-mark'
  public readonly battle: Battle
  public available: boolean = true
  constructor(
    public readonly parent:
      | EffectContext<EffectTrigger>
      | DamageContext
      | AddMarkContext
      | TurnContext
      | ConsumeStackContext,
    public mark: MarkInstance,
  ) {
    super(parent)
    this.battle = parent.battle
  }
}

export class StackContext extends Context {
  readonly type = 'stack'
  public readonly battle: Battle
  public available: boolean = true

  constructor(
    public readonly parent: AddMarkContext,
    public readonly existingMark: MarkInstance,
    public readonly incomingMark: MarkInstance,
    public readonly stacksBefore: number,
    public readonly durationBefore: number,
    public stacksAfter: number,
    public durationAfter: number,
    public readonly stackStrategy: StackStrategy,
  ) {
    super(parent)
    this.battle = parent.battle
  }

  // 获取叠层变化量
  get stackChange(): number {
    return this.stacksAfter - this.stacksBefore
  }

  get durationChange(): number {
    return this.durationAfter - this.durationBefore
  }

  // 更新叠层后的值（允许effect修改）
  updateStacksAfter(newStacks: number): void {
    this.stacksAfter = newStacks
  }

  updateDurationAfter(newDuration: number): void {
    this.durationAfter = newDuration
  }
}

export class ConsumeStackContext extends Context {
  readonly type = 'consumeStack'
  public readonly battle: Battle
  public available: boolean = true

  constructor(
    public readonly parent: EffectContext<EffectTrigger> | DamageContext,
    public readonly mark: MarkInstance,
    public readonly requestedAmount: number,
    public actualAmount: number = 0,
  ) {
    super(parent)
    this.battle = parent.battle
  }

  // 允许效果修改实际消耗的数量
  setActualAmount(amount: number): void {
    this.actualAmount = Math.max(0, Math.min(amount, this.mark.stack, this.requestedAmount))
  }
}

export type TriggerContextMap = {
  [EffectTrigger.OnBattleStart]: Battle

  [EffectTrigger.BeforeSort]: UseSkillContext
  [EffectTrigger.BeforeUseSkillCheck]: UseSkillContext
  [EffectTrigger.AfterUseSkillCheck]: UseSkillContext
  [EffectTrigger.PreDamage]: UseSkillContext
  [EffectTrigger.OnCritPreDamage]: UseSkillContext
  [EffectTrigger.BeforeMultiHit]: UseSkillContext
  [EffectTrigger.BeforeHit]: UseSkillContext
  [EffectTrigger.OnHit]: UseSkillContext
  [EffectTrigger.OnMiss]: UseSkillContext
  [EffectTrigger.AfterAttacked]: UseSkillContext
  [EffectTrigger.OnDefeat]: UseSkillContext
  [EffectTrigger.SkillUseEnd]: UseSkillContext

  [EffectTrigger.OnBeforeCalculateDamage]: DamageContext
  [EffectTrigger.OnDamage]: DamageContext
  [EffectTrigger.Shield]: DamageContext
  [EffectTrigger.PostDamage]: DamageContext
  [EffectTrigger.OnCritPostDamage]: DamageContext

  [EffectTrigger.TurnStart]: TurnContext
  [EffectTrigger.TurnEnd]: TurnContext

  [EffectTrigger.OnBeforeAddMark]: AddMarkContext
  [EffectTrigger.OnAnyMarkAdded]: AddMarkContext
  [EffectTrigger.OnRemoveMark]: RemoveMarkContext
  [EffectTrigger.OnMarkCreated]: AddMarkContext
  [EffectTrigger.OnMarkDestroy]: RemoveMarkContext
  [EffectTrigger.OnMarkDurationEnd]: TurnContext

  [EffectTrigger.OnStackBefore]: StackContext
  [EffectTrigger.OnStack]: StackContext
  [EffectTrigger.OnBeforeConsumeStack]: ConsumeStackContext
  [EffectTrigger.OnConsumeStack]: ConsumeStackContext
  [EffectTrigger.OnBeforeHeal]: HealContext
  [EffectTrigger.OnHeal]: HealContext

  [EffectTrigger.BeforeRageGain]: RageContext
  [EffectTrigger.BeforeRageLoss]: RageContext
  [EffectTrigger.OnRageGain]: RageContext
  [EffectTrigger.OnRageLoss]: RageContext

  [EffectTrigger.OnSwitchIn]: SwitchPetContext
  [EffectTrigger.OnSwitchOut]: SwitchPetContext
  [EffectTrigger.OnOwnerSwitchIn]: SwitchPetContext
  [EffectTrigger.OnOwnerSwitchOut]: SwitchPetContext

  [EffectTrigger.BeforeTransform]: TransformContext
  [EffectTrigger.OnTransform]: TransformContext
  [EffectTrigger.AfterTransform]: TransformContext
  [EffectTrigger.OnTransformEnd]: TransformContext

  [EffectTrigger.BeforeEffect]: AllContext
  [EffectTrigger.AfterEffect]: AllContext
}

export class EffectContext<T extends EffectTrigger> extends Context {
  readonly type = 'effect'
  public readonly battle: Battle
  public available: boolean = true

  public success?: boolean
  constructor(
    public readonly parent: TriggerContextMap[T],
    public readonly trigger: T,
    public readonly source: SkillInstance | MarkInstance,
    public readonly effect?: Effect<EffectTrigger>,
  ) {
    super(parent)
    this.battle = parent.battle
  }
}

export class TransformContext extends Context {
  readonly type = 'transform'
  public readonly battle: Battle
  public available: boolean = true

  constructor(
    public readonly parent: EffectContext<EffectTrigger> | Battle,
    public readonly target: Pet | SkillInstance | MarkInstance,
    public readonly targetType: 'pet' | 'skill' | 'mark',
    public readonly fromBase: any, // Species | BaseSkill | BaseMark
    public readonly toBase: any, // Species | BaseSkill | BaseMark
    public readonly transformType: 'temporary' | 'permanent',
    public readonly priority: number,
    public readonly causedBy?: MarkInstance | SkillInstance | Effect<EffectTrigger>,
  ) {
    super(parent)
    this.battle = parent.battle
  }
}
