/** Synchronous battle values. No event streams, timers, schedulers or async producers. */
export interface ValueSubscription {
  unsubscribe(): void
}
let collecting: Set<ReactiveValue<unknown>> | undefined

export abstract class ReactiveValue<T> {
  private listeners = new Set<() => void>()
  private ended = false
  protected abstract read(): T
  protected observed(): void {}
  protected unobserved(): void {}

  get value(): T {
    collecting?.add(this as ReactiveValue<unknown>)
    return this.read()
  }

  /** Invalidations carry no cached payload: derived reads always see current inputs. */
  watch(listener: () => void): () => void {
    if (this.ended) return () => {}
    this.listeners.add(listener)
    try {
      if (this.listeners.size === 1) this.observed()
    } catch (error) {
      this.listeners.delete(listener)
      this.unobserved()
      throw error
    }
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.unobserved()
    }
  }

  subscribe(listener: (value: T) => void): ValueSubscription {
    if (this.ended) return { unsubscribe() {} }
    let first = true,
      previous: T
    const publish = () => {
      const value = this.value
      if (first || !Object.is(value, previous)) {
        first = false
        previous = value
        listener(value)
      }
    }
    const stop = this.watch(publish)
    try {
      publish()
    } catch (error) {
      stop()
      throw error
    }
    return { unsubscribe: stop }
  }

  protected changed(): void {
    for (const listener of [...this.listeners]) if (this.listeners.has(listener)) listener()
  }

  get isComplete(): boolean {
    return this.ended
  }
  get observerCount(): number {
    return this.listeners.size
  }
  map<U>(project: (value: T) => U): ReactiveValue<U> {
    return derived(() => project(this.value))
  }
  complete(): void {
    this.ended = true
    this.listeners.clear()
    this.unobserved()
  }
}

export class Signal<T> extends ReactiveValue<T> {
  constructor(private current: T) {
    super()
  }
  protected read(): T {
    return this.current
  }
  next(value: T): void {
    if (Object.is(value, this.current)) return
    this.current = value
    this.changed()
  }
}

class DerivedValue<T> extends ReactiveValue<T> {
  private evaluating = false
  private stops = new Map<ReactiveValue<unknown>, () => void>()
  constructor(private calculate: () => T) {
    super()
  }
  protected read(): T {
    if (this.evaluating) throw new Error('Circular battle value dependency')
    const previous = collecting,
      dependencies = new Set<ReactiveValue<unknown>>()
    this.evaluating = true
    collecting = dependencies
    try {
      const result = this.calculate()
      if (this.observerCount) this.connect(dependencies)
      return result
    } finally {
      collecting = previous
      this.evaluating = false
    }
  }
  protected observed(): void {
    this.read()
  }
  protected unobserved(): void {
    for (const stop of this.stops.values()) stop()
    this.stops.clear()
  }
  private connect(dependencies: Set<ReactiveValue<unknown>>): void {
    for (const [dependency, stop] of this.stops) {
      if (!dependencies.has(dependency)) {
        stop()
        this.stops.delete(dependency)
      }
    }
    for (const dependency of dependencies) {
      if (!this.stops.has(dependency))
        this.stops.set(
          dependency,
          dependency.watch(() => this.changed()),
        )
    }
  }
}

export function derived<T>(calculate: () => T, dependencies: ReactiveValue<unknown>[] = []): ReactiveValue<T> {
  return new DerivedValue(() => {
    for (const value of dependencies) void value.value
    return calculate()
  })
}
export function combineValues<T>(values: ReactiveValue<T>[]): ReactiveValue<T[]> {
  return describeValue(
    derived(() => values.map(value => value.value)),
    { type: 'combine', inputs: values },
  )
}
export function isReactiveValue(value: unknown): value is ReactiveValue<unknown> {
  return value instanceof ReactiveValue
}

export interface ValueRecipe {
  type: string
  [key: string]: unknown
}
const recipes = new WeakMap<ReactiveValue<unknown>, ValueRecipe>()
export function describeValue<T>(value: ReactiveValue<T>, recipe: ValueRecipe): ReactiveValue<T> {
  recipes.set(value, recipe)
  return value
}
export function getValueRecipe(value: ReactiveValue<unknown>): ValueRecipe | undefined {
  return recipes.get(value)
}
export type ValueProjection = 'add' | 'multiply' | 'divide' | 'min' | 'max' | 'sum' | 'stage'
export function projectValue(
  value: ReactiveValue<unknown>,
  operation: ValueProjection,
  operand = 0,
): ReactiveValue<number> {
  return describeValue(
    derived(() => {
      const input = value.value
      if (operation === 'sum') return (input as number[]).reduce((a, b) => a + b, 0)
      const n = Number(input)
      switch (operation) {
        case 'add':
          return n + operand
        case 'multiply':
          return Math.floor(n * operand)
        case 'divide':
          if (operand === 0) throw new Error('Division by zero')
          return Math.floor(n / operand)
        case 'min':
          return Math.min(n, operand)
        case 'max':
          return Math.max(n, operand)
        case 'stage':
          return (
            ([0.25, 0.28, 0.33, 0.4, 0.5, 0.66, 1, 1.5, 2, 2.5, 3, 3.5, 4][Math.max(-6, Math.min(6, n)) + 6] - 1) * 100
          )
      }
    }),
    { type: 'project', input: value, operation, operand },
  )
}
