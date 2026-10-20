import type { Effect } from '../../effect'
import type { ParameterCatalog } from '../parameters'
/** Author-facing contracts. Runtime implementations are exported from api.ts. */
import type {
  AddMarkContext,
  EffectContext,
  StackContext,
  ConsumeStackContext,
  DamageContext,
  HealContext,
  RageContext,
  TriggerContextMap,
  UseSkillContext,
  SwitchPetContext,
} from '../../context'
import type { EffectTrigger } from '@arcadia-eternity/const'
import type { NativeEffectTrigger } from '../../content/native-effect'
import type { BaseMark, MarkInstance } from '../../mark'
import type { Pet } from '../../pet'
import type { Player } from '../../player'
import type { BaseSkill, SkillInstance } from '../../skill'
import type { Battle } from '../../battle'

export type EventMap = { [K in NativeEffectTrigger as `${K}`]: TriggerContextMap[K] }
export type Trigger = keyof EventMap
export type Presence = 'required' | 'optional'
type Scalar = number | string | boolean
type ReadResult<T, P extends Presence> = P extends 'optional' ? T | undefined : T

declare const valueType: unique symbol
declare const bindingType: unique symbol
declare const referenceType: unique symbol

type PetAttributes = { [K in keyof Pet['stat'] as `${K}`]: Pet['stat'][K] }
type Attributes<T> = T extends Pet ? PetAttributes : T extends MarkInstance ? { stack: number } : Record<never, never>

/** Reusable single-value query. A map skips an absent input; it never supplies an invented zero. */
export interface Value<T, P extends Presence = 'required'> {
  readonly [valueType]: { readonly value: T; readonly presence: P }
  readonly map: <U>(project: (value: T) => U) => Value<U, P>
  readonly attribute: <K extends keyof Attributes<T>>(key: K) => Value<Attributes<T>[K], P>
  readonly capture: (options: { key: string; scope: 'binding' }) => BindingValue<T, P>
  readonly follow: (options: { key: string }) => BindingValue<T, P>
}

/** Explicit persistent plan, not a value readable with ctx.read or an arbitrary serializable closure. */
export interface BindingValue<T, P extends Presence = 'required'> {
  readonly [bindingType]: { readonly value: T; readonly presence: P }
  /** Pure scalar projection, recomputed when this input changes; no new temporal step. */
  readonly map: <U extends Scalar>(
    this: T extends Scalar ? BindingValue<T, P> : never,
    project: (value: T) => U,
  ) => BindingValue<U, P>
  readonly attribute: <K extends keyof Attributes<T>>(key: K) => BindingStep<Attributes<T>[K], P>
}

/** A new step must choose its temporal policy before an operator can consume it. */
export interface BindingStep<T, P extends Presence> {
  readonly capture: (options: { key: string; scope: 'binding' | 'input' }) => BindingValue<T, P>
  readonly follow: (options: { key: string }) => BindingValue<T, P>
}

/** Opaque, invariant write location. A number is not a number reference. */
export interface WritableRef<T> {
  readonly [referenceType]: (value: T) => T
}

export interface Selector<T> {
  readonly where: (predicate: (value: T) => boolean) => Selector<T>
  readonly select: <U>(project: (value: T) => U) => Selector<U>
  /** Expand each current member in order; membership is queried again on every use. */
  readonly flatMap: <U>(project: (value: T) => readonly U[]) => Selector<U>
  /** Requery and fully shuffle on each use with battle RNG. Requires an immediate trigger frame. */
  readonly shuffled: () => Selector<T>
  readonly first: () => Value<T, 'optional'>
  /** Fresh ordered membership snapshot at each read. */
  readonly all: () => Value<readonly T[]>
  readonly condition: <K extends Trigger = Trigger>(evaluate: Evaluator<T, K>) => Condition<K>
  readonly apply: <K extends Trigger = Trigger>(operator: Operator<T, K>) => Action<K>
  // Deliberately bounded writable surface; does not make every Pet key writable.
  readonly property: (
    key: [T] extends [Pet] ? 'currentHp' : [T] extends [UseSkillContext] ? 'rage' | 'evasion' | 'priority' : never,
  ) => Selector<WritableRef<number>>
}

/** Copy a fixed membership list at definition time; members retain their domain identity. */
export declare function selectFrom<T>(members: readonly T[]): Selector<T>

interface FrameServices {
  readonly read: <T, P extends Presence>(value: Value<T, P>) => ReadResult<T, P>
  readonly ops: {
    readonly modifyDamage: (event: DamageContext, change: { delta: number; percent: number }) => void
  }
}

/** Discriminated by on, including multi-trigger definitions. Reuses the real engine's context types. */
export type EffectFrame<T extends Trigger = Trigger> = {
  [K in T]: FrameServices & { readonly on: K; readonly event: EventMap[K] }
}[T]
export type Condition<T extends Trigger = Trigger> = (ctx: EffectFrame<T>) => boolean
export type Action<T extends Trigger = Trigger> = (ctx: EffectFrame<T>) => void
export type Evaluator<T, K extends Trigger = Trigger> = (ctx: EffectFrame<K>, values: readonly T[]) => boolean
export type Operator<T, K extends Trigger = Trigger> = (ctx: EffectFrame<K>, targets: readonly T[]) => void

export interface Parameter<T> extends Value<T> {
  readonly parameter: true
}
export declare function numberParam(options: {
  default: number
  tags?: readonly string[]
  legacyAliases?: readonly string[]
}): Parameter<number>
export declare function booleanParam(options: {
  default: boolean
  tags?: readonly string[]
  legacyAliases?: readonly string[]
}): Parameter<boolean>

type Parameters = Readonly<Record<string, Parameter<unknown>>>
export interface EffectDefinition<T extends Trigger, P extends Parameters> {
  readonly id: string
  readonly on: T | readonly T[]
  readonly priority?: number
  /** Engine-owned consumption runs before the action, only for mark sources. */
  readonly consumesStacks?: number
  readonly tags?: readonly string[]
  readonly parameters?: P
  /** Declare plans used inside custom execute callbacks; composed actions are discovered automatically. */
  readonly bindings?: Readonly<Record<string, BindingValue<number, Presence>>>
  readonly when?: (ctx: NoInfer<EffectFrame<T>>, params: P) => boolean
  readonly execute: (ctx: NoInfer<EffectFrame<T>>, params: P) => void
}
export declare function defineEffect<const T extends Trigger, const P extends Parameters = Record<never, never>>(
  definition: EffectDefinition<T, P>,
): EffectDefinition<T, P>

export declare const targets: {
  readonly ownerPet: Selector<Pet>
  readonly selfTeam: Selector<Pet>
  readonly selfSkills: Selector<SkillInstance>
  readonly sourceSkill: Selector<SkillInstance>
  /** Direct skill actor owner; otherwise the source pet owner. */
  readonly selfPlayer: Selector<Player>
  /** Direct skill target owner; otherwise the source pet owner's opponent. Requeried on use. */
  readonly opponentPlayer: Selector<Player>
  readonly opponentActive: Selector<Pet>
  /** Direct skill target marks; otherwise the opposing active pet marks. Requeried on use. */
  readonly opponentMarks: Selector<MarkInstance>
  readonly ownerMarks: Selector<MarkInstance>
  readonly sourceMark: Selector<MarkInstance>
}
export declare const contexts: {
  readonly battle: Selector<Battle>
  /** Nearest outer effect; excludes the effect currently executing. */
  readonly effect: Selector<EffectContext<EffectTrigger>>
  /** Nearest mark-application ancestor, queried independently on every read. */
  readonly addMark: Selector<AddMarkContext>
  /** Nearest stacking ancestor, queried independently on each use. */
  readonly stack: Selector<StackContext>
  readonly consumeStack: Selector<ConsumeStackContext>
  /** Nearest damage ancestor, queried independently on each use. */
  readonly damage: Selector<DamageContext>
  readonly heal: Selector<HealContext>
  readonly rage: Selector<RageContext>
  readonly skillUse: Selector<UseSkillContext>
  /** Nearest switch ancestor, requeried independently on each use. */
  readonly switchPet: Selector<SwitchPetContext>
  /** Searches ancestry; unlike event, a matching ancestor is not guaranteed. */
  readonly nearestSkillUse: (ctx: EffectFrame) => UseSkillContext | undefined
}
export declare const conditions: {
  readonly all: <T extends Trigger = Trigger>(...items: readonly Condition<T>[]) => Condition<T>
  readonly any: <T extends Trigger = Trigger>(...items: readonly Condition<T>[]) => Condition<T>
  readonly not: <T extends Trigger = Trigger>(item: Condition<T>) => Condition<T>
  readonly selfUsesSkill: Condition
  /** Nearest skill actor differs from source.owner; includes same-player bench and global owners. */
  readonly skillActorDiffersFromOwner: Condition
  /** Direct skill event owned by this source; unlike selfUsesSkill, no skill identity restriction. */
  readonly ownerUsesSkill: Condition
  /** Direct damage-rage event under a skill use; source pet is the rage recipient's current active pet. */
  readonly ownerReceivesDamageRage: Condition
  /** Legacy checkSelf: compare source ownership with the subject of the direct event. */
  readonly sourceOwnsEvent: Condition
  /** Source pet is the actual target of the direct skill event. */
  readonly ownerIsSkillTarget: Condition
  /** Source pet is the incoming pet of the direct switch context. */
  readonly ownerSwitchesIn: Condition
  /** Source pet is the outgoing pet of the direct switch context. */
  readonly ownerSwitchesOut: Condition
  /** Source pet currently occupies its player's active position. */
  readonly ownerIsActive: Condition
  /** Nearest skill and turn ancestors; first executed skill / last planned skill in queue order. */
  readonly firstSkillThisTurn: Condition
  readonly lastSkillThisTurn: Condition
  /** Direct source ownership; the skill owner's consecutive count is divisible by this positive integer. */
  readonly everyNthUse: (times: number) => Condition
  /** Direct mark application initiated by a source with the same owner; not target ownership. */
  readonly ownerAddsMark: Condition
  /** Direct application target equals the source owner, including a battle owner. */
  readonly ownerReceivesMark: Condition
  /** Direct event base-mark identity and initial sign, independent of its mutable stack. */
  readonly statStageChange: (stat: 'atk' | 'def' | 'spa' | 'spd' | 'spe', direction: 'up' | 'down' | 'all') => Condition
  /** Nearest damage target belongs to a different player than the source pet. */
  readonly damageTargetBelongsToOtherPlayer: Condition
  readonly selfBeDamaged: Condition
  readonly selfBeHealed: Condition
  /** One battle RNG draw on each call, including 0 and 100; short-circuiting is owned by the caller. */
  readonly chance: (percent: number | Value<number>) => Condition
}
export declare const checks: {
  readonly exists: <T>() => Evaluator<T>
}
export declare const actions: {
  /** Evaluate once at execution and run only the chosen action. Missing else is a no-op. */
  readonly choose: <T extends Trigger = Trigger>(
    condition: Condition<T>,
    whenTrue: Action<T>,
    whenFalse?: Action<T>,
  ) => Action<T>
  /** Each action queries independently, in order; no implicit success gate or shared capture. */
  readonly sequence: <T extends Trigger = Trigger>(...actions: readonly Action<T>[]) => Action<T>
}
export declare const bindings: {
  /** Evaluate both plans left to right; preserve each input's capture/follow policy. */
  readonly combine: <A, B, R extends Scalar, PA extends Presence, PB extends Presence>(
    left: BindingValue<A, PA>,
    right: BindingValue<B, PB>,
    project: (left: A, right: B) => R,
  ) => BindingValue<R, 'optional' extends PA | PB ? 'optional' : 'required'>
}
export declare const values: {
  /** Inclusive safe-integer bounds; draw once on each immediate read, never in a persistent plan. */
  readonly randomInt: (min: number, max: number) => Value<number>

  /** Read left then right once, including an absent left; project only when both exist. */
  readonly combine: <A, B, R, PA extends Presence, PB extends Presence>(
    left: Value<A, PA>,
    right: Value<B, PB>,
    project: (left: A, right: B) => R,
  ) => Value<R, 'optional' extends PA | PB ? 'optional' : 'required'>
  /** Lazy branches, freshly evaluated at the consumer's read. */
  readonly choose: <T>(condition: Condition, yes: T | Value<T>, no: T | Value<T>) => Value<T>
}

type NumericInput = number | Value<number, Presence>
// Mark options treat an absent queried property as a request for the mark default.
type DefaultedNumericInput = NumericInput | Value<number | undefined, Presence>
type StageStrategy = 'none' | 'all' | 'positive' | 'negative'
type PowerInput = NumericInput | Value<readonly number[], Presence>
export declare const ops: {
  /** Bind one effect to Skill, then Turn, then current phase; no phase means no value read. */
  readonly addTemporaryEffect: (
    effect: Effect<EffectTrigger> | Value<Effect<EffectTrigger>, Presence>,
  ) => Operator<SkillInstance | MarkInstance>
  /** Bypass shields for the selected skill uses; leaves the skill instance default unchanged. */
  readonly setIgnoreShield: () => Operator<UseSkillContext>
  /** Assign through a rage phase, retaining the RageChange event and clamping rules. */
  readonly setRage: (value: NumericInput) => Operator<Pet | Player>
  /** Assign a persistent instance flag; unlike setSureHit this does not create a use-context override. */
  readonly setSkillSureHit: (value: boolean | Value<boolean, Presence>) => Operator<SkillInstance>
  /** Resolve a parameter alias at construction; sample amount and priority per target at execution. */
  readonly addParameterModifier: (
    catalog: ParameterCatalog,
    reference: string,
    operation: 'delta' | 'override',
    amount: NumericInput,
    priority?: NumericInput,
  ) => Operator<Pet | Player>
  /** Sample amount and priority per target; match currently registered tagged parameters and bind cleanup to source marks. */
  readonly addTaggedParameterModifier: (
    tag: string,
    operation: 'delta' | 'override',
    amount: NumericInput,
    priority?: NumericInput,
  ) => Operator<Pet | Player>
  /** Append a source-mark-owned value plan to each currently tagged parameter; later registrations do not join. */
  readonly bindTaggedParameter: (options: {
    key: string
    tag: string
    operation: 'delta' | 'override'
    value: BindingValue<number, Presence>
  }) => Operator<Pet | Player>
  /** Read a prototype once, then install a temporary priority-zero transformation preserving effects. */
  readonly transformSkill: (base: Value<BaseSkill, Presence>) => Operator<SkillInstance>
  /** Remove the latest transformation record through the existing lifecycle; older records can remain. */
  readonly removeSkillTransformation: () => Operator<SkillInstance>
  /** Sample amount then priority separately per target; source marks own cleanup. */
  readonly addAttributeModifier: (
    attribute: keyof PetAttributes,
    operation: 'delta' | 'percent' | 'override',
    amount: NumericInput,
    priority?: NumericInput,
  ) => Operator<Pet>
  readonly addSkillAttributeModifier: (
    attribute: 'accuracy' | 'power' | 'rage' | 'priority',
    operation: 'delta' | 'percent' | 'override',
    amount: NumericInput,
    options?: { priority?: NumericInput; lifetime?: 'sourceMark' | 'sourceMarkOrTargetSkill' },
  ) => Operator<SkillInstance>

  /** Cancel a pending skill, mark application, rage change, stack consumption or outer effect; no rollback of prior writes. */
  readonly disableContext: () => Operator<
    UseSkillContext | AddMarkContext | RageContext | ConsumeStackContext | EffectContext<EffectTrigger>
  >
  /** Read mark, stack, duration once, in that order. Missing mark skips; missing options use mark defaults. */
  readonly addMark: (
    mark: BaseMark | Value<BaseMark, Presence>,
    options?: { stack?: DefaultedNumericInput; duration?: DefaultedNumericInput },
  ) => Operator<Pet | Battle>
  /** Read once per selected context; apply every number in order, with no rounding. */
  readonly addPower: (amount: PowerInput) => Operator<UseSkillContext>
  /** Read once; cycle the supplied values over selected application contexts. Empty input skips. */
  readonly setMarkDuration: (amount: PowerInput) => Operator<AddMarkContext>
  readonly setMarkStack: (amount: PowerInput) => Operator<AddMarkContext>
  readonly setMarkMaxStack: (amount: PowerInput) => Operator<AddMarkContext>
  readonly amplifyPower: (amount: PowerInput) => Operator<UseSkillContext>
  /** Read once per selected skill context and apply every supplied value in order, clamping each update. */
  readonly addCritRate: (amount: PowerInput) => Operator<UseSkillContext>
  /** Read per context; add every supplied number to the currently resolved hit count. */
  readonly addMultihitResult: (amount: PowerInput) => Operator<UseSkillContext>
  /** Read per context; set the initial scalar hit count from the first value. Empty input skips. */
  readonly setMultihit: (amount: PowerInput) => Operator<UseSkillContext>
  /** Read once per invocation; the first value applies to all selected contexts. Empty input skips. */
  readonly addAccuracy: (amount: PowerInput) => Operator<UseSkillContext>
  readonly setAccuracy: (amount: PowerInput) => Operator<UseSkillContext>
  /** Append an override; existing context resolution chooses highest priority, last entry on ties. */
  readonly setSureHit: (priority?: number) => Operator<UseSkillContext>
  readonly setSureMiss: (priority?: number) => Operator<UseSkillContext>
  readonly setSureCrit: (priority?: number) => Operator<UseSkillContext>
  readonly setSureNoCrit: (priority?: number) => Operator<UseSkillContext>
  /** Read once at execution; absent target skips without changing the current target. */
  readonly setActualTarget: (target: Value<Pet, Presence>) => Operator<UseSkillContext>
  readonly setIgnoreStageStrategy: (
    strategy: StageStrategy | Value<StageStrategy, Presence>,
  ) => Operator<UseSkillContext>
  /** Mark unavailable at execution time; does not undo damage already applied. */
  readonly preventDamage: () => Operator<DamageContext>
  /** Read percent, then delta, once per invocation; missing input skips all selected contexts. */
  readonly modifyRage: (change: { percent: NumericInput; delta: NumericInput }) => Operator<RageContext>
  readonly modifyHeal: (change: { percent: NumericInput; delta: NumericInput }) => Operator<HealContext>
  readonly modifyDamage: (change: { percent: NumericInput; delta: NumericInput }) => Operator<DamageContext>
  /** Read min then max once; each present bound replaces that bound without recalculating damage. */
  readonly setDamageThreshold: (bounds: { min?: NumericInput; max?: NumericInput }) => Operator<DamageContext>
  /** Evaluate amount once per operator invocation, then apply to its selected targets. Missing skips. */
  readonly heal: (amount: NumericInput) => Operator<Pet>
  readonly dealDamage: (amount: NumericInput) => Operator<Pet>
  readonly addRage: (amount: NumericInput) => Operator<Pet | Player>
  /** Remove through the mark lifecycle in selection order; already inactive marks are no-ops. */
  readonly removeMark: () => Operator<MarkInstance>
  /** Add directly, capped by current maxStacks; no mark creation or stacking phase. */
  readonly addStacks: (amount: NumericInput) => Operator<MarkInstance>
  /** The current source mark remains consumable after its owner detaches. */
  readonly consumeStacks: (amount: NumericInput) => Operator<MarkInstance>
  /** Remove stage marks through their lifecycle; omitted/empty stats means all five stats. */
  readonly reverseStatStages: (options?: {
    stats?: readonly ('atk' | 'def' | 'spa' | 'spd' | 'spe')[]
    strategy?: 'positive' | 'negative' | 'all'
  }) => Operator<Pet>
  readonly clearStatStages: (options?: {
    stats?: readonly ('atk' | 'def' | 'spa' | 'spd' | 'spe')[]
    strategy?: 'positive' | 'negative' | 'all'
  }) => Operator<Pet>
  /** Transfer the queried mark list to the first target through the existing transfer/stack phases. */
  readonly transferMarks: (marks: Value<readonly MarkInstance[]>) => Operator<Pet>
  /** Add each selected source stage to the first target, then remove its original mark even if addition is cancelled. */
  readonly transferStatStages: (
    source: Value<Pet, Presence>,
    options?: {
      stats?: readonly ('atk' | 'def' | 'spa' | 'spd' | 'spe')[]
      strategy?: 'positive' | 'negative' | 'all'
    },
  ) => Operator<Pet>
  readonly changeStatStage: (stat: 'atk' | 'def' | 'spa' | 'spd' | 'spe', amount: NumericInput) => Operator<Pet>
  /** Read delta once, then read and add to each selected numeric reference. */
  readonly add: (value: NumericInput) => Operator<WritableRef<number>>
  readonly assign: (value: NumericInput) => Operator<WritableRef<number>>
  readonly bindAttribute: (options: AttributeBindingOptions<keyof PetAttributes>) => Operator<Pet>
  readonly bindSkillAttribute: (
    options: AttributeBindingOptions<'power' | 'accuracy' | 'rage' | 'priority'>,
  ) => Operator<SkillInstance>
}
export interface AttributeBindingOptions<A extends string> {
  key: string
  attribute: A
  operation: 'delta' | 'percent' | 'override'
  value: BindingValue<number, Presence>
  /** Replace the existing contribution by default; append preserves repeated installations. */
  stacking?: 'replace' | 'append'
  lifetime: 'sourceMark'
  missing: 'detach'
}
