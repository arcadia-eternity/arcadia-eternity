import {
  AttackTargetOpinion,
  Category,
  EffectTrigger,
  IgnoreStageStrategy,
  type Element,
} from '@arcadia-eternity/const'
import type { Battle } from './battle.js'
import type { Pet, StageStat } from './pet.js'
import type { Skill } from './skill.js'
import type { Player } from './player.js'
import type { Mark } from './mark.js'
import type { BaseMark, BaseSkill, Species, MarkConfig } from './content.js'
import type { MarkOwner } from './entity.js'
import type { TrustedEffect } from './effects.js'
import type { JsonObject } from './data.js'
import { copyData } from './data.js'

export interface ContextNode {
  readonly parent: ContextNode | null
  readonly battle: Battle
  readonly kind: string
}
export abstract class Context<TParent extends ContextNode | null = ContextNode | null> implements ContextNode {
  abstract readonly kind: string
  abstract readonly type: string
  constructor(public readonly parent: TParent) {}
  get battle(): Battle {
    if (!this.parent) throw new Error('Only Battle can be a root context')
    return this.parent.battle
  }
}
export class BattleLoopContext extends Context<Battle> {
  readonly kind = 'battle-loop'
  readonly type = 'battle-loop'
}
export class SelectionContext extends Context<Battle> {
  readonly kind = 'selection'
  readonly type = 'selection'
}
export class BattleSwitchContext extends Context<Battle> {
  readonly kind = 'battle-switch'
  readonly type = 'battle-switch'
}
export interface TurnContextData {
  number: number
  petData: Record<string, JsonObject>
  plannedPetIds: string[]
  executedPetIds: string[]
}
export class TurnContext extends Context<Battle> {
  readonly kind = 'turn'
  readonly type = 'turn'
  constructor(
    parent: Battle,
    readonly data: TurnContextData = { number: parent.turn, petData: {}, plannedPetIds: [], executedPetIds: [] },
  ) {
    super(parent)
  }
  getPetData(pet: Pet): JsonObject {
    return (this.data.petData[pet.id] ??= {})
  }
}
export class UseSkillContext extends Context<TurnContext> {
  readonly kind = 'skill'
  readonly type = 'use-skill'
  priority: number
  category: Category
  element: Element
  power: number
  accuracy: number
  rage: number
  petAccuracy: number
  critRate: number
  evasion = 0
  ignoreShield: boolean
  ignoreStageStrategy: IgnoreStageStrategy
  available = true
  target: Pet
  hit = false
  crit = false
  hitCount = 1
  currentHit = 0
  multihit: number | [number, number]
  hitOverrides: { willHit: boolean; priority: number }[] = []
  critOverrides: { willCrit: boolean; priority: number }[] = []
  damage?: DamageContext
  defeated = false
  constructor(
    parent: TurnContext,
    readonly player: Player,
    readonly pet: Pet,
    public selectTarget: AttackTargetOpinion,
    public skill: Skill,
  ) {
    super(parent)
    this.priority = skill.priority
    this.category = skill.category
    this.element = skill.element
    this.power = skill.power
    this.accuracy = skill.accuracy
    this.rage = skill.rage
    this.petAccuracy = pet.stat.accuracy
    this.critRate = pet.stat.critRate
    this.ignoreShield = skill.ignoreShield
    this.ignoreStageStrategy = skill.base.ignoreOpponentStageStrategy
    this.multihit = copyData(skill.multihit)
    this.target = pet
    this.updateActualTarget()
  }
  get origin() {
    return this.player
  }
  get actualTarget() {
    return this.target
  }
  get hitResult() {
    return this.hit
  }
  get multihitResult() {
    return this.hitCount
  }
  updateActualTarget() {
    this.target =
      this.selectTarget === AttackTargetOpinion.self ? this.pet : this.battle.getOpponent(this.player).activePet
    this.evasion = this.target.stat.evasion
  }
  updateMultihitResult() {
    this.hitCount = typeof this.multihit === 'number' ? this.multihit : this.battle.randomInt(...this.multihit)
  }
  updateHitResult() {
    const override = [...this.hitOverrides].sort((a, b) => b.priority - a.priority)[0]
    const roll = this.battle.random() * 100
    this.hit =
      override?.willHit ??
      roll < (this.skill.sureHit ? 100 : ((this.accuracy * this.petAccuracy) / 100) * (1 - this.evasion / 100))
  }
  updateCritResult() {
    const override = [...this.critOverrides].sort((a, b) => b.priority - a.priority)[0]
    const roll = this.battle.random() * 100
    this.crit = override?.willCrit ?? roll < (this.skill.sureCrit ? 100 : this.critRate)
  }
  setSkill(skill: Skill, updateConfig = true) {
    if (skill.owner !== this.pet) throw new Error('Replacement skill must belong to the acting Pet')
    this.skill = skill
    if (updateConfig) {
      this.power = skill.power
      this.rage = skill.rage
      this.category = skill.category
      this.element = skill.element
      this.accuracy = skill.accuracy
      this.multihit = copyData(skill.multihit)
      this.ignoreShield = skill.ignoreShield
      this.ignoreStageStrategy = skill.base.ignoreOpponentStageStrategy
    }
  }
  amplifyPower(value: number) {
    this.power *= value
  }
  addPower(value: number) {
    this.power += value
  }
  addAccuracy(value: number) {
    this.setAccuracy(this.accuracy + value)
  }
  setAccuracy(value: number) {
    this.accuracy = Math.max(0, Math.min(100, value))
  }
  setSureHit(priority = 0) {
    this.hitOverrides.push({ willHit: true, priority })
  }
  setSureMiss(priority = 0) {
    this.hitOverrides.push({ willHit: false, priority })
  }
  setSureCrit(priority = 0) {
    this.critOverrides.push({ willCrit: true, priority })
  }
  setSureNoCrit(priority = 0) {
    this.critOverrides.push({ willCrit: false, priority })
  }
  setActualTarget(target: Pet) {
    this.target = target
    this.evasion = target.stat.evasion
  }
}
export { UseSkillContext as SkillContext }
export class SwitchPetContext extends Context<TurnContext | BattleSwitchContext | Battle> {
  readonly kind = 'switch'
  readonly type = 'switch-pet'
  readonly outgoing: Pet
  constructor(
    parent: TurnContext | BattleSwitchContext | Battle,
    readonly player: Player,
    readonly incoming: Pet,
  ) {
    super(parent)
    this.outgoing = player.activePet
  }
  get origin() {
    return this.player
  }
  get switchOutPet() {
    return this.outgoing
  }
  get switchInPet() {
    return this.incoming
  }
}
export { SwitchPetContext as SwitchContext }
export class RageContext extends Context<UseSkillContext | TurnContext | SwitchPetContext | AnyEffectContext> {
  readonly kind = 'rage'
  readonly type = 'rage-cost'
  available = true
  rageChangeResult = 0
  modified: [number, number] = [0, 0]
  constructor(
    parent: UseSkillContext | TurnContext | SwitchPetContext | AnyEffectContext,
    readonly player: Player,
    public amount: number,
    readonly direction: 'add' | 'reduce' | 'setting',
    readonly reason: string,
  ) {
    super(parent)
  }
  get target() {
    return this.player
  }
  addModified(percent: number, delta: number) {
    this.modified[0] += percent
    this.modified[1] += delta
  }
  updateRageChangeResult() {
    this.rageChangeResult = Math.floor(this.amount * (1 + this.modified[0] / 100) + this.modified[1])
  }
}
export class DamageContext extends Context<UseSkillContext | AnyEffectContext> {
  readonly kind = 'damage'
  readonly type = 'damage'
  available = true
  damageResult = 0
  modified: [number, number] = [0, 0]
  minThreshold = 0
  maxThreshold = Number.MAX_SAFE_INTEGER
  constructor(
    parent: UseSkillContext | AnyEffectContext,
    readonly source: Pet | Skill | Mark,
    readonly target: Pet,
    public baseDamage: number,
    public damageType: 'Physical' | 'Special' | 'Effect' = 'Effect',
    public crit = false,
    public effectiveness = 1,
    public ignoreShield = false,
    public randomFactor = 1,
  ) {
    super(parent)
  }
  get amount() {
    return this.damageResult
  }
  set amount(value: number) {
    this.damageResult = value
  }
  addModified(percent: number, delta: number) {
    this.modified[0] += percent
    this.modified[1] += delta
  }
  addThreshold(min?: number, max?: number) {
    if (min !== undefined) this.minThreshold = min
    if (max !== undefined) this.maxThreshold = max
  }
  updateDamageResult() {
    this.damageResult = Math.floor(
      Math.max(
        0,
        Math.min(
          this.maxThreshold,
          Math.max(
            this.minThreshold,
            this.baseDamage * this.randomFactor * (1 + this.modified[0] / 100) + this.modified[1],
          ),
        ),
      ),
    )
  }
}
export class HealContext extends Context<AnyEffectContext> {
  readonly kind = 'heal'
  readonly type = 'heal'
  available = true
  healResult = 0
  modified: [number, number] = [0, 0]
  constructor(
    parent: AnyEffectContext,
    readonly source: Pet | Skill | Mark,
    readonly target: Pet,
    public baseHeal: number,
  ) {
    super(parent)
  }
  addModified(percent: number, delta: number) {
    this.modified[0] += percent
    this.modified[1] += delta
  }
  updateHealResult() {
    this.healResult = Math.floor(Math.max(0, this.baseHeal * (1 + this.modified[0] / 100) + this.modified[1]))
  }
}
export type MarkOperationParent =
  | AnyEffectContext
  | DamageContext
  | AddMarkContext
  | RemoveMarkContext
  | StackContext
  | ConsumeStackContext
  | MarkTransferContext
  | SwitchPetContext
  | TurnContext
  | Battle
export class AddMarkContext extends Context<MarkOperationParent> {
  readonly kind = 'add-mark'
  readonly type = 'add-mark'
  available = true
  config: MarkConfig
  duration: number
  statStage?: { stat: StageStat; level: number }
  createdMark: Mark | null = null
  constructor(
    parent: MarkOperationParent,
    readonly target: MarkOwner,
    public baseMark: BaseMark,
    public stack = 1,
    readonly creatorId: string | null = null,
  ) {
    super(parent)
    this.config = copyData(baseMark.config)
    this.duration = baseMark.config.duration
  }
  overrideConfig(config: Partial<MarkConfig>) {
    Object.assign(this.config, config)
  }
  setDuration(value: number) {
    this.duration = value
  }
  setStack(value: number) {
    this.stack = value
  }
}
export class RemoveMarkContext extends Context<MarkOperationParent> {
  readonly kind = 'remove-mark'
  readonly type = 'remove-mark'
  available = true
  constructor(
    parent: MarkOperationParent,
    readonly mark: Mark,
    readonly force = false,
  ) {
    super(parent)
  }
}
export class StackContext extends Context<AddMarkContext> {
  readonly kind = 'stack'
  readonly type = 'stack'
  available = true
  readonly stacksBefore: number
  readonly durationBefore: number
  stacksAfter: number
  durationAfter: number
  constructor(
    parent: AddMarkContext,
    readonly existingMark: Mark,
  ) {
    super(parent)
    this.stacksBefore = existingMark.stack
    this.durationBefore = existingMark.duration
    this.stacksAfter = existingMark.stack
    this.durationAfter = existingMark.duration
  }
  get stackChange() {
    return this.stacksAfter - this.stacksBefore
  }
  get durationChange() {
    return this.durationAfter - this.durationBefore
  }
}
export class ConsumeStackContext extends Context<DamageContext | AnyEffectContext> {
  readonly kind = 'consume-stack'
  readonly type = 'consume-stack'
  available = true
  consumed = 0
  constructor(
    parent: DamageContext | AnyEffectContext,
    readonly mark: Mark,
    public amount: number,
  ) {
    super(parent)
  }
}
export class MarkTransferContext extends Context<SwitchPetContext | AnyEffectContext> {
  readonly kind = 'mark-transfer'
  readonly type = 'mark-transfer'
  constructor(
    parent: SwitchPetContext | AnyEffectContext,
    readonly mark: Mark,
    readonly target: MarkOwner,
  ) {
    super(parent)
  }
}
export type Transformable = Pet | Skill | Mark
export type PrototypeOf<T extends Transformable> = T extends Pet
  ? Species
  : T extends Skill
    ? BaseSkill
    : T extends Mark
      ? BaseMark
      : never
export class TransformContext<TTarget extends Transformable = Transformable> extends Context<
  Battle | AnyEffectContext
> {
  readonly kind = 'transform'
  readonly type = 'transform'
  available = true
  constructor(
    parent: Battle | AnyEffectContext,
    readonly target: TTarget,
    readonly fromBase: PrototypeOf<TTarget>,
    readonly toBase: PrototypeOf<NoInfer<TTarget>>,
  ) {
    super(parent)
  }
}
export interface TriggerContextMap {
  [EffectTrigger.OnBattleStart]: Battle
  [EffectTrigger.BeforeSort]: UseSkillContext
  [EffectTrigger.BeforeUseSkillCheck]: UseSkillContext
  [EffectTrigger.AfterUseSkillCheck]: UseSkillContext
  [EffectTrigger.BeforeMultiHit]: UseSkillContext
  [EffectTrigger.BeforeHit]: UseSkillContext
  [EffectTrigger.OnCritPreDamage]: UseSkillContext
  [EffectTrigger.PreDamage]: UseSkillContext
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
  [EffectTrigger.OnMarkCreated]: AddMarkContext
  [EffectTrigger.OnRemoveMark]: RemoveMarkContext
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
  [EffectTrigger.BeforeEffect]: AnyEffectContext
  [EffectTrigger.AfterEffect]: AnyEffectContext
}
export class EffectContext<TTrigger extends EffectTrigger> extends Context<TriggerContextMap[TTrigger]> {
  readonly kind = 'effect'
  readonly type = 'effect'
  available = true
  success = false
  constructor(
    parent: TriggerContextMap[NoInfer<TTrigger>],
    readonly trigger: TTrigger,
    readonly source: Skill | Mark,
    readonly params: JsonObject,
    readonly effect: TrustedEffect<NoInfer<TTrigger>>,
  ) {
    super(parent)
  }
}
export type AnyEffectContext = { [T in EffectTrigger]: EffectContext<T> }[EffectTrigger]
export type OperationContext =
  | Battle
  | BattleLoopContext
  | SelectionContext
  | BattleSwitchContext
  | TurnContext
  | UseSkillContext
  | DamageContext
  | HealContext
  | RageContext
  | SwitchPetContext
  | AddMarkContext
  | RemoveMarkContext
  | StackContext
  | ConsumeStackContext
  | MarkTransferContext
  | TransformContext
