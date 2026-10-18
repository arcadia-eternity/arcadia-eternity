import { Value } from '@sinclair/typebox/value'
import type { Static, TObject } from '@sinclair/typebox'
import { EffectTrigger } from '@arcadia-eternity/const'
import { HealContext, type DamageContext, type EffectContext } from '../context'
import type { Pet } from '../pet'
import { normalizeParams } from './parameters'
import { freezeContent } from './immutable'

/** Finite contextual guarantees; conditions do not add guarantees in the first compiler. */
export interface ActionCapabilities {
  ownerPet: Pet
  skillTarget: Pet
  pendingDamage: DamageContext
}
export type CapabilityNeed = keyof ActionCapabilities
export type ActionContext<N extends CapabilityNeed> = Readonly<Pick<ActionCapabilities, N>> & {
  readonly ops: { readonly heal: (target: Pet, amount: number) => void }
  readonly readMaxHp: (target: Pet) => number
}
export interface ActionRuntime {
  readonly effect: EffectContext<EffectTrigger>
  readonly capabilities: Readonly<Partial<ActionCapabilities>>
}
export interface CompiledAction<P = unknown> {
  readonly id: string
  readonly params: P
  readonly run: (runtime: ActionRuntime) => void
}
export interface RegisteredAction {
  readonly id: string
  readonly params: TObject
  readonly needs: readonly CapabilityNeed[]
  readonly compile: (input: unknown, available: readonly CapabilityNeed[]) => CompiledAction
}

const registeredActions = new WeakSet<RegisteredAction>()
const needsSet = new Set<CapabilityNeed>(['ownerPet', 'skillTarget', 'pendingDamage'])

/** A trusted implementation has one schema for both its editor contract and TS parameters. */
export function defineAction<S extends TObject, const N extends readonly CapabilityNeed[]>(definition: {
  readonly id: string
  readonly params: S
  readonly needs: N
  readonly execute: (context: ActionContext<N[number]>, params: Readonly<Static<S>>) => void
}): Omit<RegisteredAction, 'compile'> & {
  readonly compile: (input: unknown, available: readonly CapabilityNeed[]) => CompiledAction<Readonly<Static<S>>>
} {
  if (!definition.id) throw new Error('Action needs an ID')
  if (definition.needs.some(need => !needsSet.has(need)) || new Set(definition.needs).size !== definition.needs.length)
    throw new Error('Invalid action capability needs')
  const id = definition.id
  const params = freezeContent(Value.Clone(definition.params))
  const needs = Object.freeze([...definition.needs])
  const execute = definition.execute
  const action = Object.freeze({
    id,
    params,
    needs,
    compile(input: unknown, available: readonly CapabilityNeed[]) {
      for (const need of needs)
        if (!available.includes(need)) throw new Error(`CAPABILITY_MISMATCH: ${id} requires ${need}`)
      const args = normalizeParams(params, input)
      return Object.freeze({
        id,
        params: args,
        run(runtime: ActionRuntime) {
          const selected: Partial<ActionCapabilities> = {}
          for (const need of needs) {
            const value = runtime.capabilities[need]
            if (value === undefined) throw new Error(`Missing runtime capability: ${need}`)
            Object.defineProperty(selected, need, { value, enumerable: true })
          }
          const context = Object.freeze({
            ...selected,
            ops: Object.freeze({
              heal(target: Pet, amount: number) {
                if (!Number.isFinite(amount) || amount < 0) throw new Error('Invalid healing amount')
                target.heal(new HealContext(runtime.effect, runtime.effect.source, target, amount))
              },
            }),
            readMaxHp: (target: Pet) => target.stat.maxHp,
          }) as ActionContext<N[number]>
          execute(context, args)
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
  constructor(actions: readonly RegisteredAction[]) {
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
        }),
      )
    }
  }
  describeActions(): readonly Omit<RegisteredAction, 'compile'>[] {
    return Object.freeze(
      [...this.actions.values()].map(({ id, params, needs }) => Object.freeze({ id, params, needs })),
    )
  }
  compileAction(id: string, input: unknown, available: readonly CapabilityNeed[]): CompiledAction {
    const action = this.actions.get(id)
    if (!action) throw new Error(`UNKNOWN_CAPABILITY: ${id}`)
    return action.compile(input, available)
  }
}
