import { Value } from '@sinclair/typebox/value'
import type { Static, TObject } from '@sinclair/typebox'
import { EffectTrigger } from '@arcadia-eternity/const'
import { AddMarkContext, HealContext, type DamageContext, type EffectContext } from '../context'
import type { Pet } from '../pet'
import type { BaseMark } from '../mark'
import type { MarkInstanceParams } from './mark-parameters'
import { freezeContent } from './immutable'
import {
  compileParameterArguments,
  validateParameterSlots,
  type PublicParameterBindings,
  type ParameterBindingsFor,
  type ParameterLinker,
} from './capability-parameters'
import { isRegisteredTrigger, type RegisteredTrigger, type EffectSourceKind, type CompiledTrigger } from './triggers'

/** Finite contextual guarantees; conditions do not add guarantees in the first compiler. */
export interface ActionCapabilities {
  ownerPet: Pet
  skillTarget: Pet
  pendingDamage: DamageContext
}
export type CapabilityNeed = keyof ActionCapabilities
export type ActionContext<N extends CapabilityNeed> = Readonly<Pick<ActionCapabilities, N>> & {
  readonly ops: {
    readonly heal: (target: Pet, amount: number) => void
    readonly addMark: (
      target: Pet,
      base: BaseMark,
      options: {
        stack: number
        duration: number
        instanceParams?: MarkInstanceParams
      },
    ) => 'parameter-conflict' | undefined
  }
  readonly readMaxHp: (target: Pet) => number
}
export interface ActionRuntime {
  readonly effect: EffectContext<EffectTrigger>
  readonly capabilities: Readonly<Partial<ActionCapabilities>>
}
export interface CompiledAction<P = unknown> {
  readonly id: string
  readonly params: P
  readonly contentParams: unknown
  readonly run: (runtime: ActionRuntime) => void
}
export interface RegisteredAction {
  readonly publicParams: PublicParameterBindings
  readonly id: string
  readonly params: TObject
  readonly needs: readonly CapabilityNeed[]
  readonly compile: (input: unknown, available: readonly CapabilityNeed[], linker?: ParameterLinker) => CompiledAction
}

const registeredActions = new WeakSet<RegisteredAction>()
const needsSet = new Set<CapabilityNeed>(['ownerPet', 'skillTarget', 'pendingDamage'])
export function isCapabilityNeed(value: unknown): value is CapabilityNeed {
  return typeof value === 'string' && needsSet.has(value as CapabilityNeed)
}

function selectCapabilities<N extends CapabilityNeed>(
  runtime: ActionRuntime,
  needs: readonly N[],
): Pick<ActionCapabilities, N> {
  const selected: Partial<ActionCapabilities> = {}
  for (const need of needs) {
    const value = runtime.capabilities[need]
    if (value === undefined) throw new Error(`Missing runtime capability: ${need}`)
    Object.defineProperty(selected, need, { value, enumerable: true })
  }
  return selected as Pick<ActionCapabilities, N>
}
export interface CompiledPredicate {
  readonly params: unknown
  readonly test: (runtime: ActionRuntime) => boolean
}
export interface RegisteredPredicate {
  readonly publicParams: PublicParameterBindings
  readonly id: string
  readonly params: TObject
  readonly needs: readonly CapabilityNeed[]
  readonly compile: (
    input: unknown,
    available: readonly CapabilityNeed[],
    linker?: ParameterLinker,
  ) => CompiledPredicate
}
const registeredPredicates = new WeakSet<RegisteredPredicate>()
export function definePredicate<S extends TObject, const N extends readonly CapabilityNeed[]>(definition: {
  readonly id: string
  readonly params: S
  readonly needs: N
  readonly publicParams?: ParameterBindingsFor<S>
  readonly test: (context: Readonly<Pick<ActionCapabilities, N[number]>>, params: Readonly<Static<S>>) => boolean
}): RegisteredPredicate {
  if (
    !definition.id ||
    definition.needs.some(need => !isCapabilityNeed(need)) ||
    new Set(definition.needs).size !== definition.needs.length
  )
    throw new Error('Invalid predicate definition')
  const { id, test } = definition
  const params = freezeContent(Value.Clone(definition.params))
  const needs = Object.freeze([...definition.needs])
  const publicParams = freezeContent(Value.Clone(definition.publicParams ?? {})) as PublicParameterBindings
  validateParameterSlots(params, publicParams)
  const predicate: RegisteredPredicate = Object.freeze({
    id,
    params,
    needs,
    publicParams,
    compile(input: unknown, available: readonly CapabilityNeed[], linker?: ParameterLinker) {
      for (const need of needs)
        if (!available.includes(need)) throw new Error(`CAPABILITY_MISMATCH: ${id} requires ${need}`)
      const argumentsPlan = compileParameterArguments(params, publicParams, input, linker)
      return Object.freeze({
        params: argumentsPlan.content,
        test: (runtime: ActionRuntime) =>
          test(Object.freeze(selectCapabilities(runtime, needs)), argumentsPlan.read(runtime) as Readonly<Static<S>>),
      })
    },
  })
  registeredPredicates.add(predicate)
  return predicate
}

/** A trusted implementation has one schema for both its editor contract and TS parameters. */
export function defineAction<S extends TObject, const N extends readonly CapabilityNeed[]>(definition: {
  readonly id: string
  readonly params: S
  readonly needs: N
  readonly publicParams?: ParameterBindingsFor<S>
  readonly execute: (context: ActionContext<N[number]>, params: Readonly<Static<S>>) => void
}): Omit<RegisteredAction, 'compile'> & {
  readonly compile: (
    input: unknown,
    available: readonly CapabilityNeed[],
    linker?: ParameterLinker,
  ) => CompiledAction<Readonly<Static<S>>>
} {
  if (!definition.id) throw new Error('Action needs an ID')
  if (
    definition.needs.some(need => !isCapabilityNeed(need)) ||
    new Set(definition.needs).size !== definition.needs.length
  )
    throw new Error('Invalid action capability needs')
  const id = definition.id
  const params = freezeContent(Value.Clone(definition.params))
  const needs = Object.freeze([...definition.needs])
  const execute = definition.execute
  const publicParams = freezeContent(Value.Clone(definition.publicParams ?? {})) as PublicParameterBindings
  validateParameterSlots(params, publicParams)
  const action = Object.freeze({
    id,
    params,
    needs,
    publicParams,
    compile(input: unknown, available: readonly CapabilityNeed[], linker?: ParameterLinker) {
      for (const need of needs)
        if (!available.includes(need)) throw new Error(`CAPABILITY_MISMATCH: ${id} requires ${need}`)
      const argumentsPlan = compileParameterArguments(params, publicParams, input, linker)
      const args = argumentsPlan.base as Readonly<Static<S>>
      return Object.freeze({
        id,
        contentParams: argumentsPlan.content,
        params: args,
        run(runtime: ActionRuntime) {
          const selected = selectCapabilities(runtime, needs)
          const context = Object.freeze({
            ...selected,
            ops: Object.freeze({
              addMark(
                target: Pet,
                base: BaseMark,
                options: { stack: number; duration: number; instanceParams?: MarkInstanceParams },
              ) {
                if (
                  !Number.isInteger(options.stack) ||
                  options.stack < 1 ||
                  !Number.isInteger(options.duration) ||
                  options.duration < 1
                )
                  throw new Error('Invalid mark stack or duration')
                return runtime.effect.battle.addMark(
                  new AddMarkContext(
                    runtime.effect,
                    target,
                    base,
                    options.stack,
                    options.duration,
                    undefined,
                    options.instanceParams,
                  ),
                )
              },
              heal(target: Pet, amount: number) {
                if (!Number.isFinite(amount) || amount < 0) throw new Error('Invalid healing amount')
                target.heal(new HealContext(runtime.effect, runtime.effect.source, target, amount))
              },
            }),
            readMaxHp: (target: Pet) => target.stat.maxHp,
          }) as ActionContext<N[number]>
          runtime.effect.battle.executionBudget.action(runtime.effect.battle.currentTurn, () => {
            execute(context, argumentsPlan.read(runtime) as Readonly<Static<S>>)
          })
        },
      })
    },
  })
  registeredActions.add(action)
  return action
}

/** Immutable trusted definitions only; compiled uses hold their own normalized arguments. */
export class CapabilityRegistry {
  private readonly actions = new Map<string, RegisteredAction>()
  private readonly triggers = new Map<string, RegisteredTrigger>()
  private readonly predicates = new Map<string, RegisteredPredicate>()
  constructor(
    actions: readonly RegisteredAction[],
    options: { triggers?: readonly RegisteredTrigger[]; predicates?: readonly RegisteredPredicate[] } = {},
  ) {
    for (const trigger of options.triggers ?? []) {
      if (!isRegisteredTrigger(trigger)) throw new Error('Trigger must be created by defineTrigger')
      if (this.triggers.has(trigger.id)) throw new Error(`Duplicate trigger capability: ${trigger.id}`)
      this.triggers.set(trigger.id, trigger)
    }
    for (const predicate of options.predicates ?? []) {
      if (!registeredPredicates.has(predicate)) throw new Error('Predicate must be created by definePredicate')
      if (this.predicates.has(predicate.id)) throw new Error(`Duplicate predicate capability: ${predicate.id}`)
      this.predicates.set(predicate.id, predicate)
    }
    for (const action of actions) {
      if (!registeredActions.has(action)) throw new Error('Action must be created by defineAction')
      if (this.actions.has(action.id)) throw new Error(`Duplicate action capability: ${action.id}`)
      // Copy metadata and retain the compiled factory, never the caller's mutable container.
      this.actions.set(
        action.id,
        Object.freeze({
          id: action.id,
          params: freezeContent(Value.Clone(action.params)),
          needs: Object.freeze([...action.needs]),
          compile: action.compile,
          publicParams: action.publicParams,
        }),
      )
    }
  }
  compileTrigger(id: string, input: unknown, sourceKind: EffectSourceKind): CompiledTrigger {
    const trigger = this.triggers.get(id)
    if (!trigger) throw new Error(`UNKNOWN_CAPABILITY: ${id}`)
    return trigger.compile(input, sourceKind)
  }
  compilePredicate(
    id: string,
    input: unknown,
    available: readonly CapabilityNeed[],
    linker?: ParameterLinker,
  ): CompiledPredicate {
    const predicate = this.predicates.get(id)
    if (!predicate) throw new Error(`UNKNOWN_CAPABILITY: ${id}`)
    return predicate.compile(input, available, linker)
  }
  describeTriggers(): readonly Omit<RegisteredTrigger, 'compile'>[] {
    return Object.freeze(
      [...this.triggers.values()].map(({ id, trigger, params, provides }) =>
        Object.freeze({ id, trigger, params, provides }),
      ),
    )
  }
  describePredicates(): readonly Omit<RegisteredPredicate, 'compile'>[] {
    return Object.freeze(
      [...this.predicates.values()].map(({ id, params, needs, publicParams }) =>
        Object.freeze({ id, params, needs, publicParams }),
      ),
    )
  }
  describeActions(): readonly Omit<RegisteredAction, 'compile'>[] {
    return Object.freeze(
      [...this.actions.values()].map(({ id, params, needs, publicParams }) =>
        Object.freeze({ id, params, needs, publicParams }),
      ),
    )
  }
  compileAction(
    id: string,
    input: unknown,
    available: readonly CapabilityNeed[],
    linker?: ParameterLinker,
  ): CompiledAction {
    const action = this.actions.get(id)
    if (!action) throw new Error(`UNKNOWN_CAPABILITY: ${id}`)
    return action.compile(input, available, linker)
  }
}
