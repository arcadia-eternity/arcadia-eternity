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
  return derived(() => values.map(value => value.value))
}
export function isReactiveValue(value: unknown): value is ReactiveValue<unknown> {
  return value instanceof ReactiveValue
}
