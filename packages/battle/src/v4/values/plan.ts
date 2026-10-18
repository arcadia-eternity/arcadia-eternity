import { ExecutionBudgetExceeded } from '../execution/budget'
import type { StatTypeOnBattle } from '@arcadia-eternity/const'
import { captureReads } from './dependencies'
import type { Player } from '../player'
import type { Pet } from '../pet'
import { type ReactiveValue, untracked } from '../reactiveValue'

export type ReadMode = { mode: 'follow' } | { mode: 'capture'; captureScope: 'binding' | 'input' }
export type RootReadMode = { mode: 'follow' } | { mode: 'capture'; captureScope: 'binding' }
type Options<M = ReadMode> = M & { key: string }
interface Member<T> {
  id: string
  generation: number
  value: T
}
export type CaptureState = { anchor: string; value: unknown } | { anchor: string; error: string }
export class BindingStateError extends Error {}
export interface SelectionState {
  ids: string[]
  generations: number[]
}
export interface BindingState {
  captures: Map<string, CaptureState>
  selections: Map<string, SelectionState>
  nextGeneration: number
}
export function emptyBindingState(): BindingState {
  return { captures: new Map(), selections: new Map(), nextGeneration: 0 }
}
export class Evaluation {
  readonly used = new Map<string, string>()
  private readonly memoized = new Map<object, unknown>()
  memo<T>(node: object, read: () => T): T {
    if (this.memoized.has(node)) return this.memoized.get(node) as T
    this.beforeCompute?.()
    const value = read()
    this.memoized.set(node, value)
    return value
  }
  constructor(
    readonly state: BindingState,
    readonly restoring = false,
    private readonly beforeCompute?: () => void,
  ) {}
  node(key: string, kind: string): void {
    if (!key || this.used.has(key)) throw new BindingStateError(`Duplicate value node: ${key}`)
    this.used.set(key, kind)
  }
  capture<T>(key: string, anchor: string, read: () => T): T {
    const old = this.state.captures.get(key)
    if (old?.anchor === anchor) {
      if ('error' in old) throw new Error(old.error)
      return old.value as T
    }
    if (this.restoring) throw new BindingStateError(`Missing or mismatched capture: ${key}`)
    try {
      const value = untracked(() => captureReads(read))
      this.state.captures.set(key, { anchor, value })
      return value
    } catch (error) {
      if (error instanceof ExecutionBudgetExceeded) throw error
      this.state.captures.set(key, {
        anchor,
        error: error instanceof Error ? error.message : typeof error === 'string' ? error : 'Value evaluation failed',
      })
      throw error
    }
  }
  members<T extends { id: string }>(key: string, input: readonly T[]): Member<T>[] {
    const old = this.state.selections.get(key)
    const ids = input.map(x => x.id)
    if (new Set(ids).size !== ids.length) throw new BindingStateError(`Duplicate selection member: ${key}`)
    const generations = ids.map(id => {
      const index = old?.ids.indexOf(id) ?? -1
      if (index >= 0) return old!.generations[index]
      if (this.restoring) throw new BindingStateError(`Mismatched selection: ${key}`)
      return ++this.state.nextGeneration
    })
    if (this.restoring && (!old || old.ids.length !== ids.length))
      throw new BindingStateError(`Mismatched selection: ${key}`)
    this.state.selections.set(key, { ids, generations })
    return input.map((value, index) => ({ id: value.id, generation: generations[index], value }))
  }
}

/** Trusted TS calculation, never a serialized expression or a runtime type system. */
export class ValuePlan<T> {
  constructor(private readonly calculate: (frame: Evaluation) => T) {}
  evaluate(frame: Evaluation): T {
    return frame.memo(this, () => this.calculate(frame))
  }
  map<U>(project: (value: T) => U): ValuePlan<U> {
    return new ValuePlan(frame => project(this.evaluate(frame)))
  }
}
export class Selection<T extends { id: string }> {
  constructor(private readonly calculate: (frame: Evaluation) => Member<T>[]) {}
  evaluate(frame: Evaluation): Member<T>[] {
    return frame.memo(this, () => this.calculate(frame))
  }
  attribute(this: Selection<Pet>, attribute: `${StatTypeOnBattle}`, options: Options): SelectedValues<number> {
    return new SelectedValues(frame => {
      frame.node(options.key, 'attribute')
      const read = () =>
        this.evaluate(frame).map(member => {
          const get = () => {
            const value = member.value.attributeSystem.getAttribute$(attribute).value
            if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid attribute: ${attribute}`)
            return value
          }
          const value =
            options.mode === 'capture' && options.captureScope === 'input'
              ? frame.capture(JSON.stringify([options.key, member.id]), String(member.generation), get)
              : get()
          return { ...member, value }
        })
      return options.mode === 'capture' && options.captureScope === 'binding'
        ? frame.capture(options.key, 'binding', read)
        : read()
    })
  }
}
export class SelectedValues<T> {
  constructor(private readonly calculate: (frame: Evaluation) => Member<T>[]) {}
  evaluate(frame: Evaluation): Member<T>[] {
    return frame.memo(this, () => this.calculate(frame))
  }
  requireOne(): ValuePlan<T> {
    return new ValuePlan(frame => {
      const members = this.evaluate(frame)
      if (members.length !== 1) throw new Error('Expected exactly one selected value')
      return members[0].value
    })
  }
}
export const select = {
  activePet(player: Player, options: Options<RootReadMode>): Selection<Pet> {
    return new Selection(frame => {
      frame.node(options.key, 'selection')
      const read = () => [player.activePet]
      const pets = options.mode === 'capture' ? frame.capture(options.key, 'binding', read) : read()
      return frame.members(options.key, pets)
    })
  },
}
export const values = {
  constant<T>(value: T): ValuePlan<T> {
    return new ValuePlan(() => value)
  },
  reactive<T>(value: ReactiveValue<T>): ValuePlan<T> {
    return new ValuePlan(() => value.value)
  },
  combine<P extends Record<string, ValuePlan<unknown>>, R>(
    inputs: P,
    project: (input: { [K in keyof P]: P[K] extends ValuePlan<infer T> ? T : never }) => R,
  ): ValuePlan<R> {
    return new ValuePlan(frame => {
      const results: [string, unknown][] = []
      const failures: unknown[] = []
      // Eager siblings retain structural tracking even when another input faults.
      for (const [key, plan] of Object.entries(inputs)) {
        try {
          results.push([key, plan.evaluate(frame)])
        } catch (error) {
          if (error instanceof ExecutionBudgetExceeded) throw error
          failures.push(error)
        }
      }
      if (failures.length) throw failures.find(error => error instanceof BindingStateError) ?? failures[0]
      return project(
        Object.fromEntries(results) as {
          [K in keyof P]: P[K] extends ValuePlan<infer T> ? T : never
        },
      )
    })
  },
}
export interface ValueDefinition<A> {
  readonly id: string
  readonly build: (args: A) => ValuePlan<number>
}
export function defineValue<A>(id: string, build: (args: A) => ValuePlan<number>): ValueDefinition<A> {
  if (!id) throw new Error('Value definition needs a stable ID')
  return Object.freeze({ id, build })
}
