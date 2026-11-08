import { nanoid } from 'nanoid'
import { checkConfigRead, type ConfigReadDependency } from '../config'
import { ExecutionBudgetExceeded } from '../execution/budget'
import { derived, ReactiveValue, describeValue, checkValueRead, getValueRecipe } from '../reactiveValue'
import { Modifier, DurationType } from '../attributeSystem'
import type { MarkInstance } from '../mark'
import { Pet } from '../pet'
import type { SkillInstance } from '../skill'
import type { StatTypeOnBattle } from '@arcadia-eternity/const'
import { Evaluation, emptyBindingState, BindingStateError, type ValueDefinition, type BindingState } from './plan'
import { traceReads, bindingEntity, bindingOwner, bindingBattle, type BindingTarget } from './dependencies'
import { describeCleanup, getModifierCleanup } from '../snapshotBindings'

/** Recoverable absence; unlike invalid plans this may wait for a structural update. */
export class BindingInputUnavailable extends Error {}

type Result = { ok: true; value: number } | { ok: false; error: Error }
export class BoundValue extends ReactiveValue<number> {
  private result: Result = { ok: false, error: new Error('Binding is not active') }
  private stop: (() => void) | undefined
  private publishedDependencies = new Set<object>()
  constructor(
    readonly calculation: ReactiveValue<Result>,
    readonly dependencies: Set<ReactiveValue<unknown>>,
    readonly configDependencies: Set<ConfigReadDependency> = new Set(),
  ) {
    super()
  }
  start(restoring: boolean, allowInitialMissing = false): void {
    const refresh = () => {
      const result = this.calculation.value
      const currentDependencies = new Set<object>([...this.dependencies, ...this.configDependencies])
      const changed =
        result.ok !== this.result.ok ||
        (result.ok && this.result.ok && result.value !== this.result.value) ||
        currentDependencies.size !== this.publishedDependencies.size ||
        [...currentDependencies].some(value => !this.publishedDependencies.has(value))
      this.publishedDependencies = currentDependencies
      this.result = result
      if (changed) this.changed()
    }
    try {
      this.stop = this.calculation.watch(refresh)
      refresh()
      if (
        !restoring &&
        !this.result.ok &&
        !(allowInitialMissing && this.result.error instanceof BindingInputUnavailable)
      )
        throw this.result.error
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
    for (const dependency of this.configDependencies) checkConfigRead(dependency.config, dependency.key)
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
  allowInitialMissing = false,
): BoundValue {
  if ('attribute' in target && !bindingEntity(target).attributeSystem.hasAttribute(target.attribute))
    throw new Error('Invalid binding target attribute')
  const battle = bindingBattle(target)
  if (!battle) throw new Error('Value binding requires a Battle')
  if ('parameter' in target && !battle.configSystem.isRegistered(target.parameter))
    throw new Error('Unregistered parameter binding target')
  const plan = definition.build(args)
  const dependencies = new Set<ReactiveValue<unknown>>()
  const configDependencies = new Set<ConfigReadDependency>()
  const bound = new BoundValue(
    derived((): Result => {
      dependencies.clear()
      configDependencies.clear()
      try {
        const value = battle.executionBudget.run(battle.currentTurn, () =>
          traceReads(
            target,
            dependencies,
            () => plan.evaluate(new Evaluation(state, restoring, () => battle.executionBudget.chargeComputation())),
            configDependencies,
          ),
        )
        if (!Number.isFinite(value)) throw new Error('Non-finite bound value')
        return { ok: true, value }
      } catch (error) {
        if (error instanceof ExecutionBudgetExceeded) throw error
        if (restoring && error instanceof BindingStateError) throw error
        return {
          ok: false,
          error:
            error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Value evaluation failed'),
        }
      }
    }),
    dependencies,
    configDependencies,
  )
  describeValue(bound, { type: 'bound', key: definition.id, args, state, target })
  bound.start(restoring, allowInitialMissing)
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
  target: Pet | SkillInstance
  attribute: `${StatTypeOnBattle}` | 'power' | 'rage' | 'priority'
  definition: ValueDefinition<A>
  args: A
  source: MarkInstance
  effectId: string
  bindingKey: string
  operation: 'delta' | 'override' | 'percent'
  priority?: number
  /** Append independent contributions; replacement remains the default. */
  stacking?: 'replace' | 'append'
  /** Keep an initially unavailable plan subscribed so structural follow can recover. */
  allowInitialMissing?: boolean
  followsMarkOwner?: boolean
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
  if (options.definition.source && options.definition.source(options.args) !== options.source)
    throw new Error('Invalid bound contribution source')
  const sourceBattle = options.source.owner instanceof Pet ? options.source.owner.owner?.battle : options.source.owner
  const target: BindingTarget =
    options.target instanceof Pet
      ? { pet: options.target, attribute: options.attribute }
      : { skill: options.target, attribute: options.attribute }
  if (!sourceBattle || bindingOwner(target)?.owner?.battle !== sourceBattle)
    throw new Error('Cross-battle value binding')
  const bound = bindValue(options.definition, options.args, target, undefined, false, options.allowInitialMissing)
  const id = JSON.stringify([
    options.source.id,
    options.effectId,
    options.bindingKey,
    options.target.id,
    ...(options.stacking === 'append' ? [nanoid()] : []),
  ])
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
  modifier.followsMarkOwner = options.followsMarkOwner ?? false
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
