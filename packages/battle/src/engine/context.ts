import { calculateDamageMagnitude, freezeDamageRecord, reserveDamageStacks } from './phase/damage'
import type { NumericModifierTerm } from './modifierMath'
import type { DeferredDamage } from './phase/skill'
import { normalizeMarkInstanceParams, type MarkInstanceParams } from './content/mark-parameters'
import {
  AttackTargetOpinion,
  Category,
  DamageType,
  EffectTrigger,
  IgnoreStageStrategy,
  StackStrategy,
  type Element,
  type DamageOrigin,
  type DamagePolicy,
  type DamageIntent,
  type DamageResult,
  type DamageTraceEntry,
  type DamagePayment,
} from '@arcadia-eternity/const'
import type { Battle } from './battle'
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
  | DefeatContext
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

  private skillSureHit = false
  private skillSureCrit = false

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
  /** One-based loop cursor; advances past the resolved total on completion, but not on a miss. */
  currentHitCount = 1

  damageType: DamageType = DamageType.Physical
  typeMultiplier = 1
  minimumTypeMultiplier?: number
  stabMultiplier = 1.5
  critMultiplier = 2

  /** Flat terms bought during PreDamage for the current hit. */
  readonly paidDamageBonuses: Array<{ sourceId: string; delta: number }> = []
  baseDamage: number = 0
  randomFactor: number = 1

  defeated: boolean = false
  /** Captured on accepted execution, not at selection/context construction time. */
  previousSkillElement?: Element
  /** The successful hit has handed its damage to a mark. */
  damageDeferred = false

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
    this.skillSureHit = skill.sureHit
    this.skillSureCrit = skill.sureCrit
    this.ignoreStageStrategy = skill.base.ignoreOpponentStageStrategy
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
    else if (this.skillSureHit) this.hitResult = true
    else if (this.actualTarget === this.skill.owner)
      this.hitResult = this.battle!.random() <= (this.accuracy / 100) * (this.petAccuracy / 100)
    else
      this.hitResult =
        this.battle!.random() <= (this.accuracy / 100) * (this.petAccuracy / 100) * ((100 - this.evasion) / 100)
  }

  updateCritResult() {
    if (this.critOverrides.length > 0)
      this.crit = this.critOverrides.reduce((a, b) => (a.priority > b.priority ? a : b)).willCrit
    else this.crit = this.skillSureCrit || this.battle.random() * 100 < this.critRate
    this.logger.debug('critrate', this.critRate)
  }

  setSkill(skill: SkillInstance, updateConfig?: boolean) {
    this.skill = skill
    if (updateConfig) {
      this.power = skill.power
      this.rage = skill.rage
      this.category = skill.category
      this.element = skill.element
      this.accuracy = skill.accuracy
      this.skillSureHit = skill.sureHit
      this.skillSureCrit = skill.sureCrit
      this.ignoreStageStrategy = skill.base.ignoreOpponentStageStrategy
      this.selectTarget = skill.target
      this.updateActualTarget()
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

  setIgnoreShield() {
    this.ignoreShield = true
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

/** A confirmed knockout and its credited origin, available to OnDefeat reactions. */
export class DefeatContext extends Context {
  readonly type = 'defeat'
  public readonly battle: Battle

  constructor(
    public readonly parent: DamageContext | EffectContext<EffectTrigger>,
    public readonly target: Pet,
    public readonly killer?: Pet,
    public readonly skill?: SkillInstance,
  ) {
    super(parent)
    this.battle = parent.battle
  }
}

export class RageContext extends Context {
  readonly type = 'rage-cost'
  public readonly battle: Battle
  public available: boolean = true
  /** Actual debit, captured before reactions can change rage again. */
  public rageSpent = 0
  public rageChangeResult = 0
  gainLimit = Infinity
  constructor(
    public readonly parent:
      UseSkillContext | DamageContext | EffectContext<EffectTrigger> | TurnContext | SwitchPetContext,
    public target: Player,
    public reason: 'turn' | 'damage' | 'skill' | 'skillHit' | 'switch' | 'effect',
    public modifiedType: 'setting' | 'add' | 'reduce',
    public value: number,
    public ignoreRageObtainEfficiency: boolean = false,
    public modified: [number, number] = [0, 0],
    public readonly rounding: 'floor' | 'none' = 'floor',
  ) {
    super(parent)
    this.battle = parent.battle
  }

  /** Gain limits compose by minimum and apply after every numeric modifier. */
  limitGain(maximum: number): void {
    if (!Number.isFinite(maximum) || maximum < 0) throw new Error('Expected non-negative finite rage gain limit')
    this.gainLimit = Math.min(this.gainLimit, maximum)
  }

  addModified: (percent: number, delta: number) => void = (percent, delta) => {
    this.modified[0] += percent
    this.modified[1] += delta
  }
}

/** A fixed magnitude proposed by an effect, with independently selectable damage and defense rules. */
export interface EffectDamageOptions {
  readonly damageType?: DamageType
  readonly element?: Element
  readonly policy?: Partial<DamagePolicy>
}

export interface DamageRule {
  readonly id: string
  readonly priority?: number
  readonly target?: Pet
  readonly cost?: { readonly mark: MarkInstance; readonly stacks: number | 'all' }
  readonly change:
    | { readonly kind: 'redirect'; readonly target: Pet }
    | { readonly kind: 'prevent'; readonly amount?: number; readonly fraction?: number }
    | { readonly kind: 'survive'; readonly hp: number }
    | { readonly kind: 'heal'; readonly source: EffectContext<EffectTrigger>; readonly fraction?: number }
}

interface DamageProposal {
  modifiers: NumericModifierTerm[]
  candidates: Map<string, DamageRule>
  applied: Set<string>
  trace: DamageTraceEntry[]
  payments: Readonly<{ mark: MarkInstance; requested: number; actualAmount: number; reason: DamagePayment['reason'] }>[]
  remaining?: number
  intent?: DamageIntent
  result?: DamageResult
}

export class DamageContext extends Context {
  readonly type = 'damage'
  readonly battle: Battle
  readonly proposal: DamageProposal = {
    modifiers: [],
    candidates: new Map(),
    applied: new Set(),
    trace: [],
    payments: [],
  }
  readonly origin: DamageOrigin
  readonly policy: DamagePolicy
  available = true

  constructor(
    public readonly parent: UseSkillContext | EffectContext<EffectTrigger>,
    public readonly source: Pet | MarkInstance | SkillInstance,
    public target: Pet,
    public baseDamage: number,
    public readonly damageType: DamageType = DamageType.Effect,
    public readonly crit = false,
    public readonly effectiveness = 1,
    public readonly ignoreShield = false,
    public readonly randomFactor = 1,
    modified: [number, number] = [0, 0],
    minThreshold = 0,
    maxThreshold = Number.MAX_SAFE_INTEGER,
    public readonly element?: Element,
    origin?: DamageOrigin,
    policy?: Partial<DamagePolicy>,
  ) {
    super(parent)
    this.battle = parent.battle
    const skill =
      parent instanceof UseSkillContext ? parent.skill : source instanceof SkillInstance ? source : undefined
    const actor =
      parent instanceof UseSkillContext
        ? parent.pet
        : source instanceof Pet
          ? source
          : (parent.sourceActor ?? source.owner)
    const cast = parent instanceof UseSkillContext ? parent : undefined
    const identity: DamageOrigin = origin ?? {
      trigger: cast ? 'skill' : 'effect',
      executorId: source.id,
      petId: actor instanceof Pet ? actor.id : undefined,
      skillId: skill?.baseId,
      skillInstanceId: skill?.id,
      skillCategory: cast?.category ?? skill?.category,
      skillElement: element ?? cast?.element ?? skill?.element,
      skillTags: skill?.tags,
      hitCount: skill ? (cast?.multihitResult ?? 1) : undefined,
      effectId: parent instanceof EffectContext ? parent.effect?.id : undefined,
    }
    this.origin = freezeDamageRecord({
      ...identity,
      ...(identity.skillTags ? { skillTags: Object.freeze([...identity.skillTags]) } : {}),
    })
    const strike = damageType === DamageType.Physical || damageType === DamageType.Special
    this.policy = Object.freeze({
      skillModifiers: strike,
      shields: strike && !ignoreShield,
      skillReactions: strike,
      ...policy,
    })
    if (modified[0] || modified[1]) this.addModified(...modified)
    if (minThreshold !== 0 || maxThreshold !== Number.MAX_SAFE_INTEGER) this.addThreshold(minThreshold, maxThreshold)
  }

  static fromEffect(parent: EffectContext<EffectTrigger>, target: Pet, amount: number, options: EffectDamageOptions) {
    const { damageType, element, policy } = options
    return new DamageContext(
      parent,
      parent.source,
      target,
      amount,
      damageType,
      false,
      1,
      false,
      1,
      [0, 0],
      0,
      Number.MAX_SAFE_INTEGER,
      element,
      undefined,
      policy,
    )
  }

  get result() {
    return this.proposal.result
  }

  get damageResult(): number {
    return this.result?.dealtDamage ?? this.proposal.remaining ?? calculateDamageMagnitude(this)
  }

  private addModifiers(id: string, terms: NumericModifierTerm[]): void {
    if (this.result) throw new Error('Damage already resolved')
    if (this.proposal.remaining !== undefined) throw new Error('Damage modifiers have already been evaluated')
    if (terms.some(term => !Number.isFinite(term.value))) throw new Error('Damage modifier must be finite')
    const before = this.damageResult
    this.proposal.modifiers.push(...terms)
    this.proposal.trace.push(
      Object.freeze({ kind: 'modifier', id, targetId: this.target.id, before, after: this.damageResult }),
    )
  }

  /** Numeric terms are sampled once by authoring Values in the active effect frame. */
  addModified(percent: number, delta: number, sourceId = this.source.id as string): void {
    this.addModifiers(sourceId, [
      { type: 'percent', value: percent },
      { type: 'delta', value: delta },
    ])
  }

  /** Read-only aggregate for inspection by existing content. */
  get modified(): [number, number] {
    let percent = 0,
      delta = 0
    for (const term of this.proposal.modifiers) {
      if (term.type === 'percent') percent += term.value
      if (term.type === 'delta') delta += term.value
    }
    return [percent, delta]
  }

  get minThreshold(): number {
    return this.proposal.modifiers.reduce(
      (min, term) => (term.type === 'clampMin' ? Math.max(min, term.value) : min),
      0,
    )
  }

  get maxThreshold(): number {
    return this.proposal.modifiers.reduce(
      (max, term) => (term.type === 'clampMax' ? Math.min(max, term.value) : max),
      Number.MAX_SAFE_INTEGER,
    )
  }

  addThreshold(min?: number, max?: number, sourceId = this.source.id as string): void {
    this.addModifiers(sourceId, [
      ...(min === undefined ? [] : [{ type: 'clampMin' as const, value: min }]),
      ...(max === undefined ? [] : [{ type: 'clampMax' as const, value: max }]),
    ])
  }

  addRule(rule: DamageRule): void {
    if (this.result) throw new Error('Damage already resolved')
    if (!rule.id || !Number.isFinite(rule.priority ?? 0)) throw new Error('Invalid damage rule')
    const { applied, candidates } = this.proposal
    if (!applied.has(rule.id) && !candidates.has(rule.id))
      candidates.set(rule.id, { ...rule, target: rule.target ?? this.target })
  }

  reserveModifierCost(mark: MarkInstance, stacks: number | 'all'): boolean {
    return reserveDamageStacks(this, mark, stacks, 'modifier') > 0
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
  deferredDamage?: DeferredDamage
  public readonly instanceParams: MarkInstanceParams | undefined
  public result?: 'parameter-conflict'
  readonly type = 'add-mark'
  public readonly battle: Battle
  public available: boolean = true
  public stack: number
  public duration: number
  constructor(
    public readonly parent: EffectContext<EffectTrigger>,
    public target: Battle | Pet,
    public baseMark: BaseMark,
    stack?: number,
    duration?: number,
    public config?: Partial<MarkInstance['config']>,
    instanceParams?: MarkInstanceParams,
  ) {
    super(parent)
    this.instanceParams = normalizeMarkInstanceParams(baseMark, instanceParams)
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
      EffectContext<EffectTrigger> | DamageContext | AddMarkContext | TurnContext | StackContext | SwitchPetContext,
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
    public readonly reason: 'effect' | 'modifier' | 'rule' | 'shield' = 'effect',
  ) {
    super(parent)
    this.battle = parent.battle
  }

  // 允许效果修改实际消耗的数量
  setActualAmount(amount: number): void {
    this.actualAmount = Math.max(0, Math.min(amount, this.mark.stack, this.requestedAmount))
  }
}

type V1TriggerContextMap = {
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
  [EffectTrigger.OnDefeat]: DefeatContext
  [EffectTrigger.SkillUseEnd]: UseSkillContext

  [EffectTrigger.OnDamageReplacement]: DamageContext
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

// Current const also declares V2-only triggers. They have no V1 dispatch sites.
export type TriggerContextMap = V1TriggerContextMap &
  Record<Exclude<EffectTrigger, keyof V1TriggerContextMap>, AllContext>

export class EffectContext<T extends EffectTrigger> extends Context {
  readonly type = 'effect'
  public readonly battle: Battle
  public available: boolean = true

  readonly sourceActor?: Pet
  public success?: boolean
  constructor(
    public readonly parent: TriggerContextMap[T],
    public readonly trigger: T,
    public readonly source: SkillInstance | MarkInstance,
    public readonly effect?: Effect<EffectTrigger>,
  ) {
    super(parent)
    this.battle = parent.battle
    this.sourceActor = source.owner instanceof Pet ? source.owner : undefined
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
