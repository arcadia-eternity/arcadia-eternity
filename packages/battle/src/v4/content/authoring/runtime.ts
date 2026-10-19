import { type effectId, type EffectTrigger, type StatTypeWithoutHp } from '@arcadia-eternity/const'
import { DamageContext, HealContext, UseSkillContext, type AllContext, type EffectContext } from '../../context'
import { Pet } from '../../pet'
import { SkillInstance } from '../../skill'
import { MarkInstanceImpl } from '../../mark'
import { defineNativeEffect, type NativeEffectTrigger } from '../../content/native-effect'
import type { SnapshotCatalog } from '../../snapshot'
import type { Effect } from '../../effect'
import type { Battle } from '../../battle'
import type { ValueDefinition } from '../../values/plan'
import { Evaluation, ValuePlan, defineValue } from '../../values/plan'
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
const writes = new WeakMap<object, { target: Pet; set: (value: number) => void }>()
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
function selector<T>(query: (ctx: Frame) => readonly T[]): C.Selector<T> {
  return {
    where: predicate => selector(ctx => query(ctx).filter(predicate)),
    select: project => selector(ctx => query(ctx).map(project)),
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
          if (!(target instanceof Pet)) throw new Error('Expected pet write target')
          const ref = {} as C.WritableRef<number>
          writes.set(ref, {
            target,
            set: number => {
              target[key] = number
            },
          })
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
export const targets: typeof C.targets = {
  ownerPet: selector(ctx => {
    const pet = owner(ctx)
    return pet ? [pet] : []
  }),
  opponentActive: selector(ctx => {
    const player = owner(ctx)?.owner
    return player ? [scope(ctx).battle.getOpponent(player).activePet] : []
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
  damage: selector(ctx => {
    const event = nearestContext(ctx, DamageContext)
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
  nearestSkillUse: ctx => nearestContext(ctx, UseSkillContext),
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
  ownerUsesSkill: ctx => ctx.event instanceof UseSkillContext && owner(ctx) === ctx.event.pet,
  selfBeDamaged: ctx => ctx.event instanceof DamageContext && owner(ctx) === ctx.event.target,
  selfBeHealed: ctx => ctx.event instanceof HealContext && owner(ctx) === ctx.event.target,
  chance: percent => {
    if (!Number.isFinite(percent)) throw new Error('Expected finite probability')
    return ctx => engine(ctx).battle.random() < percent / 100
  },
}
export const checks: typeof C.checks = { exists: () => (_ctx, selected) => selected.length > 0 }
export const actions: typeof C.actions = {
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
export const values: typeof C.values = {
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
  const owner = target instanceof Pet || target instanceof MarkInstanceImpl ? target.owner : undefined
  const battle = target instanceof Pet ? target.owner?.battle : owner instanceof Pet ? owner.owner?.battle : owner
  if (battle !== engine(ctx).battle) throw new Error('Cross-battle or unowned write target')
}
function numeric<T>(
  input: number | C.Value<number, C.Presence>,
  apply: (ctx: Frame, target: T, amount: number) => void,
): C.Operator<T> {
  return (ctx, selected) => {
    for (const target of selected) assertWriteTarget(ctx, target)
    const amount = read(ctx, input)
    if (amount === undefined) return
    if (typeof amount !== 'number' || !Number.isFinite(amount)) throw new Error('Expected finite numeric input')
    for (const target of selected) {
      assertWriteTarget(ctx, target)
      apply(ctx, target, amount)
    }
  }
}
/** Both modifiers share ordering, missing-input and battle ownership rules. */
function modifyContext<T extends DamageContext | HealContext>(
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
/** Legacy power actions consume the complete value list separately for every target. */
function modifyPower(
  input: Parameters<typeof C.ops.addPower>[0],
  apply: (event: UseSkillContext, amount: number) => void,
): C.Operator<UseSkillContext> {
  return (ctx, selected) => {
    selected.forEach(event => {
      if (event.battle !== engine(ctx).battle) throw new Error('Cross-battle skill context')
      const result = read(ctx, input)
      if (result === undefined) return
      const amounts = Array.isArray(result) ? result : [result]
      amounts.forEach(amount => {
        if (event.battle !== engine(ctx).battle) throw new Error('Cross-battle skill context')
        if (typeof amount !== 'number' || !Number.isFinite(amount)) throw new Error('Expected finite numeric input')
        apply(event, amount)
      })
    })
  }
}
export const ops: typeof C.ops = {
  addPower: input => modifyPower(input, (event, amount) => event.addPower(amount)),
  amplifyPower: input => modifyPower(input, (event, amount) => event.amplifyPower(amount)),
  modifyDamage: input => modifyContext(input, 'damage'),
  modifyHeal: input => modifyContext(input, 'heal'),
  heal: amount =>
    numeric(amount, (ctx, pet, n) => {
      const source = engine(ctx)
      pet.heal(new HealContext(source, source.source, pet, n))
    }),
  consumeStacks: amount => numeric(amount, (ctx, mark, n) => mark.consumeStack(engine(ctx), n)),
  changeStatStage: (stat, amount) =>
    numeric(amount, (ctx, pet, n) => pet.addStatStage(engine(ctx), stat as StatTypeWithoutHp, n)),
  assign: amount =>
    numeric(amount, (_ctx, ref, n) => {
      const write = writes.get(ref)
      if (!write) throw new Error('Foreign write reference')
      write.set(n)
    }),
  bindAttribute: input => {
    const options = { ...input }
    const operator: ReturnType<typeof C.ops.bindAttribute> = (ctx, selected) => {
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
        })
    }
    actionBindings.set(operator, [{ key: options.key, value: options.value }])
    return operator
  },
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
