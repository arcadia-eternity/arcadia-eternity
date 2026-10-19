import { type effectId, type EffectTrigger, type StatTypeWithoutHp } from '@arcadia-eternity/const'
import { DamageContext, HealContext, UseSkillContext, type AllContext, type EffectContext } from '../../context'
import { Pet } from '../../pet'
import { SkillInstance } from '../../skill'
import { MarkInstanceImpl } from '../../mark'
import { defineNativeEffect, type NativeEffectTrigger } from '../../content/native-effect'
import { Evaluation, ValuePlan, defineValue } from '../../values/plan'
import { BindingInputUnavailable, installValueModifier } from '../../values/binding'
import { observeMarks, observeOwner } from './relations'
import type * as C from './contracts'

type Frame = C.EffectFrame
type Reader = (ctx: Frame) => unknown
type BoundReader = (ctx: Frame, evaluation: Evaluation) => { value: unknown; anchor: string }
const readers = new WeakMap<object, Reader>()
const plans = new WeakMap<object, BoundReader>()
const engines = new WeakMap<Frame, EffectContext<EffectTrigger>>()
const writes = new WeakMap<object, { target: Pet; set: (value: number) => void }>()
function engine(ctx: Frame) {
  const result = engines.get(ctx)
  if (!result) throw new Error('Foreign authoring frame')
  return result
}
function read(ctx: Frame, input: unknown): unknown {
  if (input !== null && typeof input === 'object') {
    const reader = readers.get(input)
    if (!reader) throw new Error('Expected an immediate value')
    engine(ctx).battle.executionBudget.chargeComputation()
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
    condition: evaluate => ctx => evaluate(ctx, query(ctx as Frame)),
    apply: operator => ctx => {
      engine(ctx as Frame).battle.executionBudget.chargeComputation()
      operator(ctx, query(ctx as Frame))
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
  const source = engine(ctx).source
  observeOwner(source)
  return source.owner instanceof Pet ? source.owner : undefined
}
export const targets: typeof C.targets = {
  ownerPet: selector(ctx => {
    const pet = owner(ctx)
    return pet ? [pet] : []
  }),
  opponentActive: selector(ctx => {
    const player = owner(ctx)?.owner
    return player ? [engine(ctx).battle.getOpponent(player).activePet] : []
  }),
  ownerMarks: selector(ctx => {
    const pet = owner(ctx)
    if (!pet) return []
    observeMarks(pet)
    return [...pet.marks]
  }),
  sourceMark: selector(ctx => {
    const source = engine(ctx).source
    return source instanceof MarkInstanceImpl ? [source] : []
  }),
}
export const contexts: typeof C.contexts = {
  nearestSkillUse(ctx) {
    let event: AllContext | null = engine(ctx).parent
    while (event) {
      if (event instanceof UseSkillContext) return event
      event = event.parent
    }
    return undefined
  },
}
export const conditions: typeof C.conditions = {
  selfUsesSkill(ctx) {
    const skill = contexts.nearestSkillUse(ctx)
    const source = engine(ctx).source
    return !!skill && source.owner === skill.pet && (!(source instanceof SkillInstance) || source === skill.skill)
  },
  selfBeDamaged: ctx => ctx.event instanceof DamageContext && owner(ctx) === ctx.event.target,
}
export const checks: typeof C.checks = { exists: () => (_ctx, selected) => selected.length > 0 }
export const actions: typeof C.actions = {
  sequence:
    (...actions) =>
    ctx => {
      for (const action of actions) action(ctx)
    },
}
export const values: typeof C.values = {
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
    parameters: definition.parameters ? Object.freeze({ ...definition.parameters }) : undefined,
  })
export const numberParam: typeof C.numberParam = options => {
  if (!Number.isFinite(options.default)) throw new Error('Non-finite parameter default')
  const initial = options.default
  return Object.freeze(
    Object.assign(
      value<number>(() => initial),
      { parameter: true as const },
    ),
  )
}
export const booleanParam: typeof C.booleanParam = options => {
  const initial = options.default
  return Object.freeze(
    Object.assign(
      value<boolean>(() => initial),
      { parameter: true as const },
    ),
  )
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
export const ops: typeof C.ops = {
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
    return (ctx, selected) => {
      const source = engine(ctx)
      for (const target of selected) assertWriteTarget(ctx, target)
      if (!(source.source instanceof MarkInstanceImpl)) throw new Error('Binding requires a source mark')
      const plan = plans.get(options.value)
      if (!plan) throw new Error('Expected a persistent plan')
      const definition = defineValue(
        `authoring-prototype/${source.effect?.id}/${options.key}`,
        () =>
          new ValuePlan(evaluation => {
            const result = plan(ctx, evaluation).value
            if (result === undefined) throw new BindingInputUnavailable('Missing bound input')
            if (typeof result !== 'number') throw new Error('Expected numeric bound input')
            return result
          }),
      )
      for (const target of selected)
        installValueModifier({
          definition,
          args: undefined,
          source: source.source,
          effectId: source.effect?.id ?? 'prototype',
          bindingKey: options.key,
          target,
          attribute: options.attribute,
          operation: options.operation,
          allowInitialMissing: true,
        })
    }
  },
}
/** Explicit opt-in adapter; does not register examples or change the production catalog. */
export function compileEffect<T extends C.Trigger, P extends Readonly<Record<string, C.Parameter<unknown>>>>(
  input: C.EffectDefinition<T, P>,
) {
  const definition = defineEffect(input)
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
    return result
  }
  const parameters = definition.parameters ?? ({} as P)
  return defineNativeEffect({
    id: definition.id as effectId,
    triggers: (Array.isArray(definition.on) ? definition.on : [definition.on]) as NativeEffectTrigger[],
    priority: definition.priority,
    when: definition.when ? ctx => definition.when!(frame(ctx), parameters) : undefined,
    apply: ctx => definition.execute(frame(ctx), parameters),
  })
}
