import { nanoid } from 'nanoid'
import { Modifier, DurationType } from '../../attributeSystem'
import {
  type effectId,
  type EffectTrigger,
  type StatTypeWithoutHp,
  type CleanStageStrategy,
  IgnoreStageStrategy,
} from '@arcadia-eternity/const'
import {
  AddMarkContext,
  DamageContext,
  HealContext,
  UseSkillContext,
  SwitchPetContext,
  TurnContext,
  type AllContext,
  EffectContext,
  RageContext,
  StackContext,
  RemoveMarkContext,
} from '../../context'
import { Pet } from '../../pet'
import { Player } from '../../player'
import { RagePhase } from '../../phase/rage'
import { SkillInstance } from '../../skill'
import { BaseMark, BaseStatLevelMark, MarkInstanceImpl, type MarkInstance } from '../../mark'
import { defineNativeEffect, type NativeEffectTrigger } from '../../content/native-effect'
import type { SnapshotCatalog } from '../../snapshot'
import type { Effect } from '../../effect'
import type { Battle } from '../../battle'
import type { ValueDefinition } from '../../values/plan'
import { Evaluation, ValuePlan, defineValue, values as planValues } from '../../values/plan'
import { BindingInputUnavailable, installValueModifier } from '../../values/binding'
import type * as C from './contracts'
import { AuthoringParameters, declareParameter } from './parameters'

type Frame = C.EffectFrame
type Reader = (ctx: Frame) => unknown
type BoundReader = (ctx: Frame, evaluation: Evaluation) => { value: unknown; anchor: string }
const readers = new WeakMap<object, Reader>()
const plans = new WeakMap<object, BoundReader>()
const engines = new WeakMap<Frame, EffectContext<EffectTrigger>>()
interface BindingArgs {
  source: MarkInstanceImpl
}
interface BindingDeclaration {
  key: string
  value: C.BindingValue<number, C.Presence>
}
interface CompiledBinding extends BindingDeclaration {
  definition: ValueDefinition<BindingArgs>
}
const scopes = new WeakMap<Frame, { source: EffectContext<EffectTrigger>['source']; battle: Battle }>()
const actionBindings = new WeakMap<object, readonly BindingDeclaration[]>()
const frameBindings = new WeakMap<Frame, ReadonlyMap<string, CompiledBinding>>()
const effectBindings = new WeakMap<Effect<EffectTrigger>, readonly CompiledBinding[]>()
const frameParameters = new WeakMap<Frame, AuthoringParameters>()
const compiledParameters = new WeakMap<Effect<EffectTrigger>, AuthoringParameters>()
function scope(ctx: Frame) {
  const result = scopes.get(ctx)
  if (!result) throw new Error('Foreign authoring scope')
  return result
}
/** Persistent evaluation carries only domain identity, never a transient trigger context. */
function bindingFrame(source: MarkInstanceImpl, parameters: AuthoringParameters): Frame {
  if (!(source instanceof MarkInstanceImpl)) throw new Error('Invalid authored binding source')
  const battle = source.owner instanceof Pet ? source.owner.owner?.battle : source.owner
  if (!battle) throw new Error('Authored binding source requires a Battle')
  const unavailable = () => {
    throw new Error('Persistent queries cannot access a trigger event or perform actions')
  }
  const frame = {
    get on() {
      return unavailable()
    },
    get event() {
      return unavailable()
    },
    read: (input: unknown) => read(frame as Frame, input),
    ops: { modifyDamage: unavailable },
  } as Frame
  scopes.set(frame, { source, battle })
  frameParameters.set(frame, parameters)
  return frame
}
function compileBindings(
  effectId: string,
  declarations: readonly BindingDeclaration[],
  parameters: AuthoringParameters,
): Map<string, CompiledBinding> {
  const result = new Map<string, CompiledBinding>()
  for (const declaration of declarations) {
    const previous = result.get(declaration.key)
    if (previous) {
      if (previous.value !== declaration.value) throw new Error(`Conflicting authored binding: ${declaration.key}`)
      continue
    }
    if (!declaration.key) throw new Error('Binding needs a stable key')
    const plan = plans.get(declaration.value)
    if (!plan) throw new Error('Expected a persistent plan')
    const definition = defineValue(
      `authoring/${JSON.stringify([effectId, declaration.key])}`,
      (args: BindingArgs) => {
        const frame = bindingFrame(args.source, parameters)
        return new ValuePlan(evaluation => {
          const value = plan(frame, evaluation).value
          if (value === undefined) throw new BindingInputUnavailable('Missing bound input')
          if (typeof value !== 'number') throw new Error('Expected numeric bound input')
          return value
        })
      },
      { source: args => args?.source },
    )
    result.set(declaration.key, { ...declaration, definition })
  }
  return result
}
/** Register code identity and its static value factories together in a host-owned catalog. */
export function registerEffect(catalog: SnapshotCatalog, effect: Effect<EffectTrigger>): SnapshotCatalog {
  const bindings = effectBindings.get(effect)
  if (!bindings) throw new Error('Expected an authored effect')
  return catalog.registerEffectWithBindings(
    effect.id,
    effect,
    bindings.map(binding => binding.definition),
  )
}
/** Install in each new battle; restored configuration already contains the saved parameter state. */
export function effectParameters(effect: Effect<EffectTrigger>) {
  const parameters = compiledParameters.get(effect)
  if (!parameters) throw new Error('Expected an authored effect')
  return parameters.catalog
}
const writes = new WeakMap<object, { target: Pet | UseSkillContext; get: () => number; set: (value: number) => void }>()
function engine(ctx: Frame) {
  const result = engines.get(ctx)
  if (!result) throw new Error('Persistent queries cannot access a trigger event or perform actions')
  return result
}
function read(ctx: Frame, input: unknown): unknown {
  if (input !== null && typeof input === 'object') {
    const reader = readers.get(input)
    if (!reader) throw new Error('Expected an immediate value')
    scope(ctx).battle.executionBudget.chargeComputation()
    return reader(ctx)
  }
  return input
}
function attribute(input: unknown, key: string): unknown {
  if (input === undefined) return undefined
  if (input instanceof MarkInstanceImpl && !input.isActive) return undefined
  if (input instanceof Pet || input instanceof MarkInstanceImpl) return input.attributeSystem.getAttribute$(key).value
  throw new Error('Attribute input must be a domain entity')
}
function value<T, P extends C.Presence = 'required'>(reader: Reader): C.Value<T, P> {
  const result = {
    map: (project: (input: unknown) => unknown) =>
      value(ctx => {
        const input = reader(ctx)
        return input === undefined ? undefined : project(input)
      }),
    attribute: (key: string) => value(ctx => attribute(reader(ctx), key)),
    capture: ({ key }: { key: string }) => rootPlan(reader, key, true),
    follow: ({ key }: { key: string }) => rootPlan(reader, key, false),
  }
  readers.set(result, reader)
  // Opaque public contracts are minted only here; implementation metadata stays private.
  return result as unknown as C.Value<T, P>
}
function rootPlan(reader: Reader, key: string, capture: boolean) {
  return binding((ctx, evaluation) => {
    evaluation.node(key, 'selection')
    const input = capture ? evaluation.capture(key, 'binding', () => reader(ctx)) : reader(ctx)
    const identity =
      input !== undefined &&
      typeof input === 'object' &&
      input !== null &&
      'id' in input &&
      typeof input.id === 'string'
        ? input.id
        : 'scalar'
    const members = evaluation.members(key, input === undefined ? [] : [{ id: identity }])
    return { value: input, anchor: members.length ? String(members[0].generation) : 'absent' }
  })
}
function binding(reader: BoundReader): C.BindingValue<unknown, C.Presence> {
  const memoNode = {}
  const memo: BoundReader = (ctx, evaluation) => evaluation.memo(memoNode, () => reader(ctx, evaluation))
  const result = {
    map: (project: (input: unknown) => unknown) =>
      binding((ctx, evaluation) => {
        const input = memo(ctx, evaluation)
        return { ...input, value: input.value === undefined ? undefined : project(input.value) }
      }),
    attribute: (key: string) => {
      const step = (input: { key: string; scope?: 'binding' | 'input' }, capture: boolean) => {
        const options = { ...input }
        return binding((ctx, evaluation) => {
          evaluation.node(options.key, 'attribute')
          const get = () => {
            const input = memo(ctx, evaluation)
            const readAttribute = () => attribute(input.value, key)
            return {
              ...input,
              value:
                capture && options.scope === 'input'
                  ? evaluation.capture(options.key, input.anchor, readAttribute)
                  : readAttribute(),
            }
          }
          return capture && options.scope === 'binding' ? evaluation.capture(options.key, 'binding', get) : get()
        })
      }
      return {
        capture: (options: { key: string; scope: 'binding' | 'input' }) => step(options, true),
        follow: (options: { key: string }) => step(options, false),
      }
    },
  }
  plans.set(result, memo)
  return result as unknown as C.BindingValue<unknown, C.Presence>
}
export const selectFrom: typeof C.selectFrom = members => {
  const snapshot = [...members]
  return selector(() => snapshot)
}
function selector<T>(query: (ctx: Frame) => readonly T[]): C.Selector<T> {
  return {
    where: predicate => selector(ctx => query(ctx).filter(predicate)),
    select: project => selector(ctx => query(ctx).map(project)),
    flatMap: project => selector(ctx => query(ctx).flatMap(item => [...project(item)])),
    shuffled: () => selector(ctx => engine(ctx).battle.shuffle([...query(ctx)])),
    first: () => value(ctx => query(ctx)[0]),
    all: () => value(ctx => [...query(ctx)]),
    condition: evaluate => ctx => evaluate(ctx, query(ctx as Frame)),
    apply: operator => {
      const action = (ctx: Parameters<typeof operator>[0]) => {
        engine(ctx as Frame).battle.executionBudget.chargeComputation()
        operator(ctx, query(ctx as Frame))
      }
      actionBindings.set(action, actionBindings.get(operator) ?? [])
      return action
    },
    property: function (key) {
      return selector(ctx =>
        query(ctx).map(target => {
          const ref = {} as C.WritableRef<number>
          if (target instanceof Pet && key === 'currentHp') {
            writes.set(ref, {
              target,
              get: () => target.currentHp,
              set: value => {
                target.currentHp = value
              },
            })
          } else if (target instanceof UseSkillContext && (key === 'rage' || key === 'evasion' || key === 'priority')) {
            const property: 'rage' | 'evasion' | 'priority' = key
            const event: UseSkillContext = target
            writes.set(ref, {
              target,
              get: () => event[property],
              set: value => {
                event[property] = value
              },
            })
          } else throw new Error('Unsupported numeric write reference')
          return ref
        }),
      )
    },
  }
}
function owner(ctx: Frame): Pet | undefined {
  const source = scope(ctx).source
  return source.owner instanceof Pet ? source.owner : undefined
}
function directSkillEvent(ctx: Frame): UseSkillContext | undefined {
  const event = engines.get(ctx)?.parent
  return event instanceof UseSkillContext ? event : undefined
}
export const targets: typeof C.targets = {
  sourceSkill: selector(ctx => {
    const source = scope(ctx).source
    return source instanceof SkillInstance ? [source] : []
  }),
  selfTeam: selector(ctx => [...(directSkillEvent(ctx)?.pet.owner?.team ?? owner(ctx)?.owner?.team ?? [])]),
  selfSkills: selector(ctx => [...(directSkillEvent(ctx)?.pet.skills ?? owner(ctx)?.skills ?? [])]),
  ownerPet: selector(ctx => {
    const pet = owner(ctx)
    return pet ? [pet] : []
  }),
  selfPlayer: selector(ctx => {
    const event = directSkillEvent(ctx)
    const player = event ? event.pet.owner : owner(ctx)?.owner
    return player ? [player] : []
  }),
  opponentPlayer: selector(ctx => {
    const event = directSkillEvent(ctx)
    if (event) {
      const player = event.actualTarget?.owner
      return player ? [player] : []
    }
    const player = owner(ctx)?.owner
    return player ? [scope(ctx).battle.getOpponent(player)] : []
  }),
  opponentActive: selector(ctx => {
    const player = owner(ctx)?.owner
    return player ? [scope(ctx).battle.getOpponent(player).activePet] : []
  }),
  opponentMarks: selector(ctx => {
    const event = directSkillEvent(ctx)
    if (event) return [...event.actualTarget!.marks]
    const player = owner(ctx)?.owner
    return player ? [...scope(ctx).battle.getOpponent(player).activePet.marks] : []
  }),
  ownerMarks: selector(ctx => {
    const pet = owner(ctx)
    if (!pet) return []
    return [...pet.marks]
  }),
  sourceMark: selector(ctx => {
    const source = scope(ctx).source
    return source instanceof MarkInstanceImpl ? [source] : []
  }),
}
function nearestContext<T extends AllContext>(ctx: Frame, kind: abstract new (...args: never[]) => T): T | undefined {
  let event: AllContext | null = engine(ctx).parent
  while (event) {
    if (event instanceof kind) return event
    event = event.parent
  }
  return undefined
}
export const contexts: typeof C.contexts = {
  battle: selector(ctx => [engine(ctx).battle]),
  effect: selector(ctx => {
    const event = nearestContext(ctx, EffectContext)
    return event ? [event] : []
  }),
  addMark: selector(ctx => {
    const event = nearestContext(ctx, AddMarkContext)
    return event ? [event] : []
  }),
  stack: selector(ctx => {
    const event = nearestContext(ctx, StackContext)
    return event ? [event] : []
  }),
  damage: selector(ctx => {
    const event = nearestContext(ctx, DamageContext)
    return event ? [event] : []
  }),
  rage: selector(ctx => {
    const event = nearestContext(ctx, RageContext)
    return event ? [event] : []
  }),
  heal: selector(ctx => {
    const event = nearestContext(ctx, HealContext)
    return event ? [event] : []
  }),
  skillUse: selector(ctx => {
    const event = nearestContext(ctx, UseSkillContext)
    return event ? [event] : []
  }),
  switchPet: selector(ctx => {
    const event = nearestContext(ctx, SwitchPetContext)
    return event ? [event] : []
  }),
  nearestSkillUse: ctx => nearestContext(ctx, UseSkillContext),
}
function skillOrder(position: 'first' | 'last'): C.Condition {
  return ctx => {
    const skill = ctx.event
    if (!(skill instanceof UseSkillContext) || !(skill.parent instanceof TurnContext)) return false
    const entries = position === 'first' ? skill.parent.appledContexts : skill.parent.contexts
    return entries.find(entry => entry instanceof UseSkillContext) === skill
  }
}
export const conditions: typeof C.conditions = {
  all:
    (...items) =>
    ctx =>
      items.every(item => item(ctx)),
  any:
    (...items) =>
    ctx =>
      items.some(item => item(ctx)),
  not: item => ctx => !item(ctx),
  selfUsesSkill(ctx) {
    const skill = contexts.nearestSkillUse(ctx)
    const source = engine(ctx).source
    return !!skill && source.owner === skill.pet && (!(source instanceof SkillInstance) || source === skill.skill)
  },
  skillActorDiffersFromOwner(ctx) {
    const skill = contexts.nearestSkillUse(ctx)
    return !!skill && engine(ctx).source.owner !== skill.pet
  },
  ownerReceivesDamageRage(ctx) {
    const event = ctx.event,
      sourceOwner = engine(ctx).source.owner
    return (
      event instanceof RageContext &&
      event.reason === 'damage' &&
      event.parent instanceof UseSkillContext &&
      sourceOwner instanceof Pet &&
      sourceOwner === event.target.activePet
    )
  },
  ownerUsesSkill: ctx => ctx.event instanceof UseSkillContext && owner(ctx) === ctx.event.pet,
  sourceOwnsEvent: ctx => {
    const event = ctx.event,
      sourceOwner = engine(ctx).source.owner
    if (event instanceof UseSkillContext) return sourceOwner === event.pet
    if (event instanceof DamageContext || event instanceof HealContext) return sourceOwner === event.target
    if (
      event instanceof RageContext &&
      event.reason === 'damage' &&
      event.parent instanceof UseSkillContext &&
      sourceOwner instanceof Pet
    )
      return sourceOwner.owner === event.target
    if (event instanceof EffectContext) return sourceOwner === event.source.owner
    if (event instanceof SwitchPetContext) return sourceOwner === event.switchInPet
    if (event instanceof StackContext) return sourceOwner === event.existingMark.owner
    return false
  },
  ownerIsSkillTarget: ctx => {
    const pet = owner(ctx)
    return pet !== undefined && ctx.event instanceof UseSkillContext && pet === ctx.event.actualTarget
  },
  ownerSwitchesIn: ctx => ctx.event instanceof SwitchPetContext && owner(ctx) === ctx.event.switchInPet,
  ownerSwitchesOut: ctx => {
    const pet = owner(ctx)
    return pet !== undefined && ctx.event instanceof SwitchPetContext && pet === ctx.event.switchOutPet
  },
  ownerIsActive: ctx => owner(ctx)?.isActive() ?? false,
  firstSkillThisTurn: skillOrder('first'),
  lastSkillThisTurn: skillOrder('last'),
  everyNthUse: times => {
    if (!Number.isSafeInteger(times) || times <= 0) throw new Error('Expected positive consecutive-use interval')
    return ctx =>
      ctx.event instanceof UseSkillContext &&
      owner(ctx) === ctx.event.pet &&
      (ctx.event.skill.owner?.lastSkillUsedTimes ?? 0) % times === 0
  },
  ownerAddsMark: ctx =>
    ctx.event instanceof AddMarkContext && engine(ctx).source.owner === ctx.event.parent.source.owner,
  ownerReceivesMark: ctx => ctx.event instanceof AddMarkContext && engine(ctx).source.owner === ctx.event.target,
  statStageChange: (stat, direction) => ctx => {
    if (!(ctx.event instanceof AddMarkContext)) return false
    const mark = ctx.event.baseMark
    return (
      mark instanceof BaseStatLevelMark &&
      mark.statType === stat &&
      mark.initialLevel !== 0 &&
      (direction === 'all' || (direction === 'up' ? mark.initialLevel > 0 : mark.initialLevel < 0))
    )
  },
  damageTargetBelongsToOtherPlayer: ctx => {
    const pet = owner(ctx),
      event = nearestContext(ctx, DamageContext)
    return !!pet && !!event && pet.owner !== event.target.owner
  },
  selfBeDamaged: ctx => ctx.event instanceof DamageContext && owner(ctx) === ctx.event.target,
  selfBeHealed: ctx => ctx.event instanceof HealContext && owner(ctx) === ctx.event.target,
  chance: percent => {
    if (typeof percent === 'number' && !Number.isFinite(percent)) throw new Error('Expected finite probability')
    return ctx => {
      const amount = typeof percent === 'number' ? percent : read(ctx, percent)
      if (typeof amount !== 'number' || !Number.isFinite(amount)) throw new Error('Expected finite probability')
      return engine(ctx).battle.random() < amount / 100
    }
  },
}
export const checks: typeof C.checks = { exists: () => (_ctx, selected) => selected.length > 0 }
export const actions: typeof C.actions = {
  choose: (condition, whenTrue, whenFalse) => {
    const action: typeof whenTrue = ctx => {
      engine(ctx as Frame).battle.executionBudget.chargeComputation()
      if (condition(ctx)) whenTrue(ctx)
      else whenFalse?.(ctx)
    }
    actionBindings.set(action, [
      ...(actionBindings.get(whenTrue) ?? []),
      ...(whenFalse ? (actionBindings.get(whenFalse) ?? []) : []),
    ])
    return action
  },
  sequence: (...actions) => {
    const action = (ctx: Parameters<(typeof actions)[number]>[0]) => {
      for (const apply of actions) apply(ctx)
    }
    actionBindings.set(
      action,
      actions.flatMap(item => actionBindings.get(item) ?? []),
    )
    return action
  },
}
export const bindings: typeof C.bindings = {
  combine<A, B, R extends number | string | boolean, PA extends C.Presence, PB extends C.Presence>(
    left: C.BindingValue<A, PA>,
    right: C.BindingValue<B, PB>,
    project: (left: A, right: B) => R,
  ) {
    const a = plans.get(left),
      b = plans.get(right)
    if (!a || !b) throw new Error('Expected persistent plans')
    return binding((ctx, evaluation) =>
      planValues
        .combine(
          {
            left: new ValuePlan(frame => a(ctx, frame)),
            right: new ValuePlan(frame => b(ctx, frame)),
          },
          ({ left: l, right: r }) => ({
            anchor: JSON.stringify([l.anchor, r.anchor]),
            value: l.value === undefined || r.value === undefined ? undefined : project(l.value as A, r.value as B),
          }),
        )
        .evaluate(evaluation),
    ) as C.BindingValue<R, 'optional' extends PA | PB ? 'optional' : 'required'>
  },
}
export const values: typeof C.values = {
  randomInt: (min, max) => {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max || !Number.isSafeInteger(max - min + 1))
      throw new Error('Invalid random integer range')
    return value(ctx => engine(ctx).battle.randomInt(min, max))
  },
  combine<A, B, R, PA extends C.Presence, PB extends C.Presence>(
    left: C.Value<A, PA>,
    right: C.Value<B, PB>,
    project: (a: A, b: B) => R,
  ) {
    return value<R, 'optional' extends PA | PB ? 'optional' : 'required'>(ctx => {
      const a = read(ctx, left) as A | undefined,
        b = read(ctx, right) as B | undefined
      return a === undefined || b === undefined ? undefined : project(a, b)
    })
  },
  choose: (condition, yes, no) =>
    value(ctx => {
      const selected = condition(ctx) ? yes : no
      return selected !== null && typeof selected === 'object' && readers.has(selected) ? read(ctx, selected) : selected
    }),
}
export const defineEffect: typeof C.defineEffect = definition =>
  Object.freeze({
    ...definition,
    on: Array.isArray(definition.on) ? Object.freeze([...definition.on]) : definition.on,
    tags: definition.tags ? Object.freeze([...definition.tags]) : undefined,
    parameters: definition.parameters ? Object.freeze({ ...definition.parameters }) : undefined,
    bindings: definition.bindings ? Object.freeze({ ...definition.bindings }) : undefined,
  })
export const numberParam: typeof C.numberParam = options => {
  if (!Number.isFinite(options.default)) throw new Error('Non-finite parameter default')
  return parameter<number>(options)
}
export const booleanParam: typeof C.booleanParam = options => {
  if (typeof options.default !== 'boolean') throw new Error('Expected boolean parameter default')
  return parameter<boolean>(options)
}
function parameter<T extends number | boolean>(options: {
  default: T
  tags?: readonly string[]
  legacyAliases?: readonly string[]
}): C.Parameter<T> {
  const result: C.Parameter<T> = Object.freeze(
    Object.assign(
      value<T>(ctx => {
        const parameters = frameParameters.get(ctx)
        if (!parameters) throw new Error('Missing authored parameter context')
        const { battle, source } = scope(ctx)
        return parameters.read(result, battle.configSystem, source)
      }),
      { parameter: true as const },
    ),
  )
  declareParameter(result, options)
  return result
}

function assertWriteTarget(ctx: Frame, input: unknown): void {
  const target = input !== null && typeof input === 'object' ? (writes.get(input)?.target ?? input) : input
  const owner =
    target instanceof Pet || target instanceof MarkInstanceImpl || target instanceof SkillInstance
      ? target.owner
      : undefined
  const battle =
    target instanceof Player || target instanceof UseSkillContext
      ? target.battle
      : target instanceof Pet
        ? target.owner?.battle
        : owner instanceof Pet
          ? owner.owner?.battle
          : owner
  if (battle !== engine(ctx).battle) throw new Error('Cross-battle or unowned write target')
}
/** Source identity survives detachment; only source lifecycle operations may use this exception. */
function assertMarkLifecycleTarget(ctx: Frame, mark: MarkInstance): void {
  if (mark instanceof MarkInstanceImpl && mark.owner === null && mark === engine(ctx).source) return
  assertWriteTarget(ctx, mark)
}
function numeric<T>(
  input: number | C.Value<number, C.Presence>,
  apply: (ctx: Frame, target: T, amount: number) => void,
  validate: (ctx: Frame, target: T) => void = assertWriteTarget,
): C.Operator<T> {
  return (ctx, selected) => {
    for (const target of selected) validate(ctx, target)
    const amount = read(ctx, input)
    if (amount === undefined) return
    if (typeof amount !== 'number' || !Number.isFinite(amount)) throw new Error('Expected finite numeric input')
    for (const target of selected) {
      validate(ctx, target)
      apply(ctx, target, amount)
    }
  }
}
/** Context modifiers share ordering, missing-input and battle ownership rules. */
function modifyContext<T extends DamageContext | HealContext | RageContext>(
  input: { percent: number | C.Value<number, C.Presence>; delta: number | C.Value<number, C.Presence> },
  kind: string,
): C.Operator<T> {
  const { percent, delta } = input
  return (ctx, selected) => {
    for (const event of selected)
      if (event.battle !== engine(ctx).battle) throw new Error(`Cross-battle ${kind} context`)
    const p = read(ctx, percent)
    const d = read(ctx, delta)
    if (p === undefined || d === undefined) return
    if (typeof p !== 'number' || !Number.isFinite(p) || typeof d !== 'number' || !Number.isFinite(d))
      throw new Error('Expected finite numeric input')
    for (const event of selected) {
      if (event.battle !== engine(ctx).battle) throw new Error(`Cross-battle ${kind} context`)
      event.addModified(p, d)
    }
  }
}
/** Skill numeric actions read separately for every target, preserving list order. */
function modifySkillValues(
  input: Parameters<typeof C.ops.addPower>[0],
  apply: (event: UseSkillContext, amount: number) => void,
  consumption: 'all' | 'first' = 'all',
): C.Operator<UseSkillContext> {
  return (ctx, selected) => {
    selected.forEach(event => {
      if (event.battle !== engine(ctx).battle) throw new Error('Cross-battle skill context')
      const result = read(ctx, input)
      if (result === undefined) return
      const amounts = Array.isArray(result) ? result : [result]
      ;(consumption === 'first' ? amounts.slice(0, 1) : amounts).forEach(amount => {
        if (event.battle !== engine(ctx).battle) throw new Error('Cross-battle skill context')
        if (typeof amount !== 'number' || !Number.isFinite(amount)) throw new Error('Expected finite numeric input')
        apply(event, amount)
      })
    })
  }
}
/** Mark application setters read once and cycle values over targets, rather than re-reading per target. */
function setMarkApplicationValue(
  input: Parameters<typeof C.ops.setMarkDuration>[0],
  apply: (event: AddMarkContext, value: number) => void,
): C.Operator<AddMarkContext> {
  return (ctx, selected) => {
    const validate = (event: AddMarkContext) => {
      if (event.battle !== engine(ctx).battle) throw new Error('Cross-battle mark application context')
    }
    selected.forEach(validate)
    const result = read(ctx, input)
    const amounts = result === undefined ? [] : Array.isArray(result) ? result : [result]
    selected.forEach((event, index) => {
      const amount = amounts[index % amounts.length]
      if (amount === undefined) return
      validate(event)
      if (typeof amount !== 'number' || !Number.isFinite(amount)) throw new Error('Expected finite numeric input')
      apply(event, amount)
    })
  }
}
/** Accuracy consumes the first value once, even when more than one context is selected. */
function modifyAccuracy(input: Parameters<typeof C.ops.addAccuracy>[0], set: boolean): C.Operator<UseSkillContext> {
  return (ctx, selected) => {
    for (const event of selected) if (event.battle !== engine(ctx).battle) throw new Error('Cross-battle skill context')
    const result = read(ctx, input)
    const amount = Array.isArray(result) ? result[0] : result
    if (amount === undefined) return
    if (typeof amount !== 'number' || !Number.isFinite(amount)) throw new Error('Expected finite numeric input')
    for (const event of selected) {
      if (event.battle !== engine(ctx).battle) throw new Error('Cross-battle skill context')
      if (set) event.setAccuracy(amount)
      else event.addAccuracy(amount)
    }
  }
}
/** Shared single read for non-numeric skill context changes. */
function skillContextInput<T>(
  input: unknown,
  parse: (ctx: Frame, value: unknown) => T,
  apply: (event: UseSkillContext, value: T) => void,
): C.Operator<UseSkillContext> {
  return (ctx, selected) => {
    for (const event of selected) if (event.battle !== engine(ctx).battle) throw new Error('Cross-battle skill context')
    const value = read(ctx, input)
    if (value === undefined) return
    const parsed = parse(ctx, value)
    for (const event of selected) {
      if (event.battle !== engine(ctx).battle) throw new Error('Cross-battle skill context')
      apply(event, parsed)
    }
  }
}
function skillOverride(
  priority: number,
  apply: (event: UseSkillContext, priority: number) => void,
): C.Operator<UseSkillContext> {
  if (!Number.isFinite(priority)) throw new Error('Expected finite override priority')
  return (ctx, selected) => {
    for (const event of selected) if (event.battle !== engine(ctx).battle) throw new Error('Cross-battle skill context')
    for (const event of selected) apply(event, priority)
  }
}
/** Static contributions sample inputs per target, and append on repeated execution. */
function addAttributeModifier<T extends Pet | SkillInstance>(
  attribute: string,
  operation: 'delta' | 'percent' | 'override',
  amount: Parameters<typeof C.ops.addAttributeModifier>[2],
  priority: Parameters<typeof C.ops.addAttributeModifier>[3] = 0,
  lifetime: 'sourceMark' | 'sourceMarkOrTargetSkill' = 'sourceMark',
): C.Operator<T> {
  return (ctx, selected) => {
    for (const target of selected) {
      assertWriteTarget(ctx, target)
      const value = read(ctx, amount),
        rank = read(ctx, priority)
      if (value === undefined) continue
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        (rank !== undefined && (typeof rank !== 'number' || !Number.isFinite(rank)))
      )
        throw new Error('Expected finite modifier input')
      assertWriteTarget(ctx, target)
      const source = engine(ctx).source
      const modifier = new Modifier(
        DurationType.binding,
        `${source.id}_${attribute}_${nanoid()}`,
        value,
        operation,
        rank ?? 0,
        source instanceof MarkInstanceImpl
          ? source
          : lifetime === 'sourceMarkOrTargetSkill' && target instanceof SkillInstance
            ? target
            : undefined,
      )
      const cleanup = target.attributeSystem.addModifier(attribute, modifier)
      if (source instanceof MarkInstanceImpl) source.addAttributeModifierCleanup(cleanup)
    }
  }
}
export const ops: typeof C.ops = {
  setRage: amount =>
    numeric(amount, (ctx, target, n) => {
      const source = engine(ctx)
      const phase = new RagePhase(
        source.battle,
        source,
        target instanceof Player ? target : target.owner!,
        'effect',
        'setting',
        n,
      )
      source.battle.phaseManager.registerPhase(phase)
      source.battle.phaseManager.executePhase(phase.id)
    }),
  setIgnoreShield: () => (ctx, selected) => {
    for (const event of selected) if (event.battle !== engine(ctx).battle) throw new Error('Cross-battle skill context')
    for (const event of selected) event.setIgnoreShield()
  },
  setSkillSureHit: input => (ctx, selected) => {
    for (const skill of selected) assertWriteTarget(ctx, skill)
    const flag = read(ctx, input)
    if (flag === undefined) return
    if (typeof flag !== 'boolean') throw new Error('Expected boolean input')
    for (const skill of selected) {
      assertWriteTarget(ctx, skill)
      skill.sureHit = flag
    }
  },
  addAttributeModifier,
  addSkillAttributeModifier: (attribute, operation, amount, options = {}) =>
    addAttributeModifier(attribute, operation, amount, options.priority, options.lifetime),
  disableContext: () => (ctx, selected) => {
    for (const event of selected)
      if (event.battle !== engine(ctx).battle) throw new Error('Cross-battle cancellable context')
    for (const event of selected) {
      if (event.battle !== engine(ctx).battle) throw new Error('Cross-battle cancellable context')
      event.available = false
    }
  },
  addMark: (mark, input = {}) => {
    const { stack, duration } = input
    return (ctx, selected) => {
      const source = engine(ctx)
      const validate = (target: Pet | Battle) => {
        if (target !== source.battle) assertWriteTarget(ctx, target)
      }
      selected.forEach(validate)
      const base = mark instanceof BaseMark ? mark : read(ctx, mark)
      if (base === undefined) return
      if (!(base instanceof BaseMark)) throw new Error('Expected a base mark')
      const count = read(ctx, stack)
      const turns = read(ctx, duration)
      for (const amount of [count, turns])
        if (amount !== undefined && (typeof amount !== 'number' || !Number.isFinite(amount)))
          throw new Error('Expected finite numeric input')
      for (const target of selected) {
        validate(target)
        target.addMark(
          new AddMarkContext(source, target, base, count as number | undefined, turns as number | undefined),
        )
      }
    }
  },
  setMarkDuration: input => setMarkApplicationValue(input, (event, amount) => event.setDuration(amount)),
  setMarkStack: input => setMarkApplicationValue(input, (event, amount) => event.setStack(amount)),
  setMarkMaxStack: input => setMarkApplicationValue(input, (event, amount) => event.setMaxStack(amount)),
  addPower: input => modifySkillValues(input, (event, amount) => event.addPower(amount)),
  amplifyPower: input => modifySkillValues(input, (event, amount) => event.amplifyPower(amount)),
  addCritRate: input => modifySkillValues(input, (event, amount) => event.addCritRate(amount)),
  addMultihitResult: input => modifySkillValues(input, (event, amount) => event.addMultihitResult(amount)),
  setMultihit: input =>
    modifySkillValues(
      input,
      (event, amount) => {
        event.multihit = amount
      },
      'first',
    ),
  addAccuracy: input => modifyAccuracy(input, false),
  setAccuracy: input => modifyAccuracy(input, true),
  setSureHit: (priority = 0) => skillOverride(priority, (event, p) => event.setSureHit(p)),
  setSureMiss: (priority = -1) => skillOverride(priority, (event, p) => event.setSureMiss(p)),
  setSureCrit: (priority = 0) => skillOverride(priority, (event, p) => event.setSureCrit(p)),
  setSureNoCrit: (priority = -1) => skillOverride(priority, (event, p) => event.setSureNoCrit(p)),
  setActualTarget: input =>
    skillContextInput(
      input,
      (ctx, target) => {
        if (!(target instanceof Pet)) throw new Error('Expected Pet target')
        assertWriteTarget(ctx, target)
        return target
      },
      (event, target) => event.setActualTarget(target),
    ),
  setIgnoreStageStrategy: input =>
    skillContextInput(
      input,
      (_ctx, strategy) => {
        if (!Object.values(IgnoreStageStrategy).includes(strategy as IgnoreStageStrategy))
          throw new Error('Invalid stage strategy')
        return strategy as IgnoreStageStrategy
      },
      (event, strategy) => event.setIgnoreStageStrategy(strategy),
    ),
  preventDamage: () => (ctx, selected) => {
    for (const event of selected)
      if (event.battle !== engine(ctx).battle) throw new Error('Cross-battle damage context')
    for (const event of selected) {
      if (event.battle !== engine(ctx).battle) throw new Error('Cross-battle damage context')
      event.available = false
    }
  },
  modifyDamage: input => modifyContext(input, 'damage'),
  setDamageThreshold:
    ({ min, max }) =>
    (ctx, selected) => {
      for (const event of selected)
        if (event.battle !== engine(ctx).battle) throw new Error('Cross-battle damage context')
      const lower = min === undefined ? undefined : read(ctx, min)
      const upper = max === undefined ? undefined : read(ctx, max)
      if (lower !== undefined && (typeof lower !== 'number' || !Number.isFinite(lower)))
        throw new Error('Expected finite numeric input')
      if (upper !== undefined && (typeof upper !== 'number' || !Number.isFinite(upper)))
        throw new Error('Expected finite numeric input')
      if (lower === undefined && upper === undefined) return
      for (const event of selected) {
        if (event.battle !== engine(ctx).battle) throw new Error('Cross-battle damage context')
        event.addThreshold(lower, upper)
      }
    },
  modifyHeal: input => modifyContext(input, 'heal'),
  modifyRage: input => modifyContext(input, 'rage'),
  heal: amount =>
    numeric(amount, (ctx, pet, n) => {
      const source = engine(ctx)
      pet.heal(new HealContext(source, source.source, pet, n))
    }),
  dealDamage: amount =>
    numeric(amount, (ctx, pet, n) => {
      const source = engine(ctx)
      pet.damage(new DamageContext(source, source.source, pet, n))
    }),
  addRage: amount =>
    numeric(amount, (ctx, target, n) => {
      const source = engine(ctx)
      target.addRage(new RageContext(source, target instanceof Player ? target : target.owner!, 'effect', 'add', n))
    }),
  removeMark: () => (ctx, selected) => {
    for (const mark of selected) if (mark.isActive) assertMarkLifecycleTarget(ctx, mark)
    for (const mark of selected) {
      if (!mark.isActive) continue
      assertMarkLifecycleTarget(ctx, mark)
      const source = engine(ctx)
      source.battle.removeMark(new RemoveMarkContext(source, mark))
    }
  },
  addStacks: amount => numeric(amount, (_ctx, mark, n) => mark.addStack(n), assertMarkLifecycleTarget),
  consumeStacks: amount => (ctx, selected) => {
    // A removal callback may detach a later member of this operation's selected collection.
    // Keep that identity valid only for this invocation, after initial ownership validation.
    const validated = new Set<MarkInstance>()
    numeric<MarkInstance>(
      amount,
      (frame, mark, n) => mark.consumeStack(engine(frame), n),
      (frame, mark) => {
        if (validated.has(mark) && !mark.isActive && mark.owner === null) return
        assertMarkLifecycleTarget(frame, mark)
        validated.add(mark)
      },
    )(ctx, selected)
  },
  reverseStatStages: (options = {}) => {
    const stats = [...(options.stats ?? [])] as StatTypeWithoutHp[]
    const strategy = (options.strategy ?? 'positive') as CleanStageStrategy
    return (ctx, selected) => {
      for (const pet of selected) assertWriteTarget(ctx, pet)
      for (const pet of selected) {
        assertWriteTarget(ctx, pet)
        pet.reverseStatStage(engine(ctx), strategy, ...stats)
      }
    }
  },
  clearStatStages: (options = {}) => {
    const stats = [...(options.stats ?? [])] as StatTypeWithoutHp[]
    const strategy = (options.strategy ?? 'positive') as CleanStageStrategy
    return (ctx, selected) => {
      for (const pet of selected) assertWriteTarget(ctx, pet)
      for (const pet of selected) {
        assertWriteTarget(ctx, pet)
        for (const mark of pet.getClearableStatStageMarks(strategy, ...stats)) {
          assertWriteTarget(ctx, pet)
          ops.removeMark()(ctx, [mark])
        }
      }
    }
  },
  changeStatStage: (stat, amount) =>
    numeric(amount, (ctx, pet, n) => pet.addStatStage(engine(ctx), stat as StatTypeWithoutHp, n)),
  add: amount => (ctx, selected) => {
    for (const ref of selected) assertWriteTarget(ctx, ref)
    const delta = read(ctx, amount)
    if (delta === undefined) return
    if (typeof delta !== 'number' || !Number.isFinite(delta)) throw new Error('Expected finite numeric input')
    for (const ref of selected) {
      assertWriteTarget(ctx, ref)
      const write = writes.get(ref)
      if (!write) throw new Error('Foreign write reference')
      write.set(write.get() + delta)
    }
  },
  assign: amount =>
    numeric(amount, (_ctx, ref, n) => {
      const write = writes.get(ref)
      if (!write) throw new Error('Foreign write reference')
      write.set(n)
    }),
  bindAttribute: input => bindAttributeOperator<Pet>(input),
  bindSkillAttribute: input => bindAttributeOperator<SkillInstance>(input),
}
function bindAttributeOperator<T extends Pet | SkillInstance>(
  input: C.AttributeBindingOptions<`${keyof Pet['stat']}` | 'power' | 'rage' | 'priority'>,
): C.Operator<T> {
  const options = { ...input }
  const operator: C.Operator<T> = (ctx, selected) => {
    const source = engine(ctx)
    for (const target of selected) assertWriteTarget(ctx, target)
    if (!(source.source instanceof MarkInstanceImpl)) throw new Error('Binding requires a source mark')
    const binding = frameBindings.get(ctx)?.get(options.key)
    if (!binding || binding.value !== options.value) throw new Error('Undeclared authored binding')
    for (const target of selected)
      installValueModifier({
        definition: binding.definition,
        args: { source: source.source },
        source: source.source,
        effectId: source.effect?.id ?? binding.definition.id,
        bindingKey: options.key,
        target,
        attribute: options.attribute,
        operation: options.operation,
        allowInitialMissing: true,
        stacking: options.stacking,
      })
  }
  actionBindings.set(operator, [{ key: options.key, value: options.value }])
  return operator
}
/** Explicit opt-in adapter; does not register examples or change the production catalog. */
export function compileEffect<T extends C.Trigger, P extends Readonly<Record<string, C.Parameter<unknown>>>>(
  input: C.EffectDefinition<T, P>,
) {
  const definition = defineEffect(input)
  const parameterSet = new AuthoringParameters(definition.id, definition.parameters ?? {})
  const bindings = compileBindings(
    definition.id,
    [
      ...(actionBindings.get(definition.execute) ?? []),
      ...Object.entries(definition.bindings ?? {}).map(([key, value]) => ({ key, value })),
    ],
    parameterSet,
  )
  const frame = (source: EffectContext<EffectTrigger>): C.EffectFrame<T> => {
    const result = {
      on: source.trigger,
      event: source.parent,
      read: (input: unknown) => read(result as Frame, input),
      ops: {
        modifyDamage: (event: DamageContext, change: { delta: number; percent: number }) => {
          if (event.battle !== source.battle) throw new Error('Cross-battle damage context')
          event.addModified(change.percent, change.delta)
        },
      },
    } as C.EffectFrame<T>
    engines.set(result as Frame, source)
    scopes.set(result as Frame, source)
    frameBindings.set(result as Frame, bindings)
    frameParameters.set(result as Frame, parameterSet)
    return result
  }
  const parameters = definition.parameters ?? ({} as P)
  const effect = defineNativeEffect({
    id: definition.id as effectId,
    triggers: (Array.isArray(definition.on) ? definition.on : [definition.on]) as NativeEffectTrigger[],
    priority: definition.priority,
    consumesStacks: definition.consumesStacks,
    tags: definition.tags,
    when: definition.when ? ctx => definition.when!(frame(ctx), parameters) : undefined,
    apply: ctx => definition.execute(frame(ctx), parameters),
  })
  effectBindings.set(effect, [...bindings.values()])
  compiledParameters.set(effect, parameterSet)
  return effect
}
