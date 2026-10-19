/** Author-facing contracts. Runtime implementations are exported from api.ts. */
import type {
  AddMarkContext,
  DamageContext,
  HealContext,
  TriggerContextMap,
  UseSkillContext,
  SwitchPetContext,
} from '../../context'
import type { NativeEffectTrigger } from '../../content/native-effect'
import type { BaseMark, MarkInstance } from '../../mark'
import type { Pet } from '../../pet'
import type { Player } from '../../player'
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
  readonly property: (this: Selector<Pet>, key: 'currentHp') => Selector<WritableRef<number>>
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
  /** Direct skill actor owner; otherwise the source pet owner. */
  readonly selfPlayer: Selector<Player>
  readonly opponentActive: Selector<Pet>
  /** Direct skill target marks; otherwise the opposing active pet marks. Requeried on use. */
  readonly opponentMarks: Selector<MarkInstance>
  readonly ownerMarks: Selector<MarkInstance>
  readonly sourceMark: Selector<MarkInstance>
}
export declare const contexts: {
  readonly battle: Selector<Battle>
  /** Nearest mark-application ancestor, queried independently on every read. */
  readonly addMark: Selector<AddMarkContext>
  /** Nearest damage ancestor, queried independently on each use. */
  readonly damage: Selector<DamageContext>
  readonly heal: Selector<HealContext>
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
  /** Direct skill event owned by this source; unlike selfUsesSkill, no skill identity restriction. */
  readonly ownerUsesSkill: Condition
  /** Source pet is the actual target of the direct skill event. */
  readonly ownerIsSkillTarget: Condition
  /** Source pet is the incoming pet of the direct switch context. */
  readonly ownerSwitchesIn: Condition
  /** Source pet is the outgoing pet of the direct switch context. */
  readonly ownerSwitchesOut: Condition
  /** Source pet currently occupies its player's active position. */
  readonly ownerIsActive: Condition
  /** Direct skill + turn ancestry; first executed skill / last planned skill in queue order. */
  readonly firstSkillThisTurn: Condition
  readonly lastSkillThisTurn: Condition
  /** Direct source ownership; the skill owner's consecutive count is divisible by this positive integer. */
  readonly everyNthUse: (times: number) => Condition
  /** Direct mark application initiated by a source with the same owner; not target ownership. */
  readonly ownerAddsMark: Condition
  /** Direct event base-mark identity and initial sign, independent of its mutable stack. */
  readonly statStageChange: (stat: 'atk' | 'def' | 'spa' | 'spd' | 'spe', direction: 'up' | 'down' | 'all') => Condition
  readonly selfBeDamaged: Condition
  readonly selfBeHealed: Condition
  /** One battle RNG draw on each call, including 0 and 100; short-circuiting is owned by the caller. */
  readonly chance: (percent: number | Value<number>) => Condition
}
export declare const checks: {
  readonly exists: <T>() => Evaluator<T>
}
export declare const actions: {
  /** Each action queries independently, in order; no implicit success gate or shared capture. */
  readonly sequence: <T extends Trigger = Trigger>(...actions: readonly Action<T>[]) => Action<T>
}
export declare const values: {
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
type PowerInput = NumericInput | Value<readonly number[], Presence>
export declare const ops: {
  /** Read mark, stack, duration once, in that order. Missing mark skips; missing options use mark defaults. */
  readonly addMark: (
    mark: BaseMark | Value<BaseMark, Presence>,
    options?: { stack?: DefaultedNumericInput; duration?: DefaultedNumericInput },
  ) => Operator<Pet | Battle>
  /** Read once per selected context; apply every number in order, with no rounding. */
  readonly addPower: (amount: PowerInput) => Operator<UseSkillContext>
  readonly amplifyPower: (amount: PowerInput) => Operator<UseSkillContext>
  /** Read once per selected skill context and apply every supplied value in order, clamping each update. */
  readonly addCritRate: (amount: PowerInput) => Operator<UseSkillContext>
  /** Read once per invocation; the first value applies to all selected contexts. Empty input skips. */
  readonly addAccuracy: (amount: PowerInput) => Operator<UseSkillContext>
  readonly setAccuracy: (amount: PowerInput) => Operator<UseSkillContext>
  /** Append an override; existing context resolution chooses highest priority, last entry on ties. */
  readonly setSureHit: (priority?: number) => Operator<UseSkillContext>
  readonly setSureMiss: (priority?: number) => Operator<UseSkillContext>
  readonly setSureCrit: (priority?: number) => Operator<UseSkillContext>
  readonly setSureNoCrit: (priority?: number) => Operator<UseSkillContext>
  /** Read percent, then delta, once per invocation; missing input skips all selected contexts. */
  readonly modifyHeal: (change: { percent: NumericInput; delta: NumericInput }) => Operator<HealContext>
  readonly modifyDamage: (change: { percent: NumericInput; delta: NumericInput }) => Operator<DamageContext>
  /** Evaluate amount once per operator invocation, then apply to its selected targets. Missing skips. */
  readonly heal: (amount: NumericInput) => Operator<Pet>
  readonly consumeStacks: (amount: NumericInput) => Operator<MarkInstance>
  readonly changeStatStage: (stat: 'atk' | 'def' | 'spa' | 'spd' | 'spe', amount: NumericInput) => Operator<Pet>
  readonly assign: (value: NumericInput) => Operator<WritableRef<number>>
  readonly bindAttribute: (options: {
    key: string
    attribute: keyof PetAttributes
    operation: 'delta' | 'percent' | 'override'
    value: BindingValue<number, Presence>
    lifetime: 'sourceMark'
    missing: 'detach'
  }) => Operator<Pet>
}
