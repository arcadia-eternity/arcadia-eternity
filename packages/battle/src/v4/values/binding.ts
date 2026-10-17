import { derived, ReactiveValue, describeValue, checkValueRead, getValueRecipe } from '../reactiveValue'
import { Modifier, DurationType } from '../attributeSystem'
import type { MarkInstance } from '../mark'
import { Pet } from '../pet'
import type { StatTypeOnBattle } from '@arcadia-eternity/const'
import { Evaluation, emptyBindingState, BindingStateError, type ValueDefinition, type BindingState } from './plan'
import { traceReads, type BindingTarget } from './dependencies'
import { describeCleanup, getModifierCleanup } from '../snapshotBindings'

type Result = { ok: true; value: number } | { ok: false; error: Error }
export class BoundValue extends ReactiveValue<number> {
  private result: Result = { ok: false, error: new Error('Binding is not active') }
  private stop: (() => void) | undefined
  private publishedDependencies = new Set<ReactiveValue<unknown>>()
  constructor(
    readonly calculation: ReactiveValue<Result>,
    readonly dependencies: Set<ReactiveValue<unknown>>,
  ) {
    super()
  }
  start(restoring: boolean): void {
    const refresh = () => {
      const result = this.calculation.value
      const changed =
        result.ok !== this.result.ok ||
        (result.ok && this.result.ok && result.value !== this.result.value) ||
        this.dependencies.size !== this.publishedDependencies.size ||
        [...this.dependencies].some(value => !this.publishedDependencies.has(value))
      this.publishedDependencies = new Set(this.dependencies)
      this.result = result
      if (changed) this.changed()
    }
    try {
      this.stop = this.calculation.watch(refresh)
      refresh()
      if (!restoring && !this.result.ok) throw this.result.error
    } catch (error) {
      this.complete()
      throw error
    }
  }
  get fault(): Error | undefined {
    return this.result.ok ? undefined : this.result.error
  }
  override get isAvailable(): boolean {
    return super.isAvailable && !this.isComplete && this.result.ok
  }
  protected read(): number {
    for (const dependency of this.dependencies) checkValueRead(dependency)
    if (!this.result.ok) throw this.result.error
    return this.result.value
  }
  override complete(): void {
    if (this.isComplete) return
    this.stop?.()
    this.stop = undefined
    this.result = { ok: false, error: new Error('Disposed value binding') }
    super.complete()
  }
}
export function bindValue<A>(
  definition: ValueDefinition<A>,
  args: A,
  target: BindingTarget,
  state: BindingState = emptyBindingState(),
  restoring = false,
): BoundValue {
  if (!target.pet.attributeSystem.hasAttribute(target.attribute)) throw new Error('Invalid binding target attribute')
  const plan = definition.build(args)
  const dependencies = new Set<ReactiveValue<unknown>>()
  const bound = new BoundValue(
    derived((): Result => {
      dependencies.clear()
      try {
        const value = traceReads(target, dependencies, () => plan.evaluate(new Evaluation(state, restoring)))
        if (!Number.isFinite(value)) throw new Error('Non-finite bound value')
        return { ok: true, value }
      } catch (error) {
        if (restoring && error instanceof BindingStateError) throw error
        return {
          ok: false,
          error:
            error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Value evaluation failed'),
        }
      }
    }),
    dependencies,
  )
  describeValue(bound, { type: 'bound', key: definition.id, args, state, target })
  bound.start(restoring)
  restoring = false
  return bound
}

/** Identity allocated during hydration; activation occurs only after all domain references exist. */
export class RestoredBoundValue extends ReactiveValue<number> {
  private bound?: BoundValue
  private stop?: () => void
  private initializing = false
  constructor(private readonly restore: () => BoundValue) {
    super()
  }
  initialize(): void {
    if (this.bound || this.isComplete) return
    if (this.initializing) throw new Error('Circular restored value binding')
    this.initializing = true
    try {
      this.bound = this.restore()
      this.stop = this.bound.watch(() => this.changed())
    } finally {
      this.initializing = false
    }
  }
  override get isAvailable(): boolean {
    this.initialize()
    return super.isAvailable && !this.isComplete && !!this.bound?.isAvailable
  }
  protected read(): number {
    this.initialize()
    if (!this.bound) throw new Error('Disposed value binding')
    return this.bound.value
  }
  override complete(): void {
    this.stop?.()
    this.stop = undefined
    this.bound?.complete()
    super.complete()
  }
}

export function validateBindingState(input: unknown): asserts input is BindingState {
  if (!input || typeof input !== 'object') throw new Error('Invalid value binding state')
  const state = input as BindingState
  if (
    !(state.captures instanceof Map) ||
    !(state.selections instanceof Map) ||
    !Number.isSafeInteger(state.nextGeneration) ||
    state.nextGeneration < 0
  )
    throw new Error('Invalid value binding state')
  for (const [key, capture] of state.captures) {
    if (
      typeof key !== 'string' ||
      !capture ||
      typeof capture.anchor !== 'string' ||
      (!Object.hasOwn(capture, 'value') && !('error' in capture && typeof capture.error === 'string'))
    )
      throw new Error('Invalid capture state')
  }
  for (const [key, selection] of state.selections) {
    if (
      typeof key !== 'string' ||
      !selection ||
      !Array.isArray(selection.ids) ||
      !Array.isArray(selection.generations) ||
      selection.ids.length !== selection.generations.length ||
      new Set(selection.ids).size !== selection.ids.length ||
      selection.ids.some(id => typeof id !== 'string') ||
      selection.generations.some(
        generation => !Number.isSafeInteger(generation) || generation <= 0 || generation > state.nextGeneration,
      )
    )
      throw new Error('Invalid selection generation state')
  }
}
export interface InstallValueModifier<A> {
  definition: ValueDefinition<A>
  args: A
  source: MarkInstance
  effectId: string
  bindingKey: string
  target: Pet
  attribute: `${StatTypeOnBattle}`
  operation: 'delta' | 'override' | 'percent'
  priority?: number
}
/** A contribution owns its subscription; disposing an old handle cannot remove a replacement. */
export interface ValueModifierBinding {
  readonly value: number | undefined
  readonly fault: Error | undefined
  readonly isDisposed: boolean
  dispose(): void
}
function bindingHandle(bound: BoundValue, remove: () => void): ValueModifierBinding {
  return {
    get value() {
      return bound.isAvailable ? bound.value : undefined
    },
    get fault() {
      return bound.fault
    },
    get isDisposed() {
      return bound.isComplete
    },
    dispose() {
      if (bound.isComplete) return
      remove()
    },
  }
}
export function installValueModifier<A>(options: InstallValueModifier<A>): ValueModifierBinding {
  if (!options.source.isActive || !options.source.owner) throw new Error('Inactive binding source')
  const sourceBattle = options.source.owner instanceof Pet ? options.source.owner.owner?.battle : options.source.owner
  if (!sourceBattle || options.target.owner?.battle !== sourceBattle) throw new Error('Cross-battle value binding')
  const bound = bindValue(options.definition, options.args, { pet: options.target, attribute: options.attribute })
  const id = JSON.stringify([options.source.id, options.effectId, options.bindingKey, options.target.id])
  const old = options.target.attributeSystem.findModifier(options.attribute, id)
  if (old) {
    if (
      getValueRecipe(old.value)?.type !== 'bound' ||
      old.source !== options.source ||
      old.type !== options.operation ||
      old.priority !== (options.priority ?? 0)
    ) {
      bound.complete()
      throw new Error('Replacement must preserve the contribution operation and priority')
    }
    const previous = old.value
    try {
      options.target.attributeSystem.replaceModifierValue(options.attribute, old, bound)
    } catch (error) {
      bound.complete()
      throw error
    }
    previous.complete()
    return bindingHandle(bound, () => getModifierCleanup(options.target.attributeSystem, old)?.())
  }
  const modifier = new Modifier(
    DurationType.binding,
    id,
    bound,
    options.operation,
    options.priority ?? 0,
    options.source,
  )
  const dispose = () => modifier.value.complete()
  describeCleanup(dispose, { type: 'bound-value', modifier })
  modifier.addCleanup(dispose)
  try {
    const cleanup = options.target.attributeSystem.addModifier(options.attribute, modifier)
    options.source.addAttributeModifierCleanup(cleanup)
    return bindingHandle(bound, cleanup)
  } catch (error) {
    getModifierCleanup(options.target.attributeSystem, modifier)?.()
    bound.complete()
    throw error
  }
}
