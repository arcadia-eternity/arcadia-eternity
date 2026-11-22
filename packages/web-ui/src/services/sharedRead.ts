/** All consumers of a resource wait on one read; each one can leave independently. */
type Flight<T, Source> = { source: Source; join(signal?: AbortSignal): Promise<T> }

export class SharedReads<T, Source = string> {
  private readonly pending = new Map<string, Flight<T, Source>>()

  get(key: string, source: Source, load: (signal: AbortSignal) => Promise<T>): Flight<T, Source> {
    const current = this.pending.get(key)
    if (current) return current

    const controller = new AbortController()
    let consumers = 0
    const result = Promise.resolve()
      .then(() => {
        controller.signal.throwIfAborted()
        return load(controller.signal)
      })
      .finally(() => {
        if (this.pending.get(key) === flight) this.pending.delete(key)
      })
    const flight: Flight<T, Source> = {
      source,
      join: signal =>
        new Promise((resolve, reject) => {
          consumers++
          let settled = false
          const leave = () => {
            if (settled) return false
            settled = true
            signal?.removeEventListener('abort', abort)
            if (--consumers === 0 && this.pending.get(key) === flight) {
              this.pending.delete(key)
              controller.abort()
            }
            return true
          }
          const abort = () => {
            if (leave()) reject(signal?.reason)
          }
          signal?.addEventListener('abort', abort, { once: true })
          result.then(
            value => {
              if (leave()) resolve(value)
            },
            error => {
              if (leave()) reject(error)
            },
          )
          if (signal?.aborted) abort()
        }),
    }
    this.pending.set(key, flight)
    return flight
  }
}
