/** Tracks readers and serializes operations by name within one management service. */
export class ArtifactAccess {
  private readonly pins = new Map<string, number>()
  private readonly locks = new Map<string, Promise<void>>()

  isPinned(name: string): boolean {
    return this.pins.has(name)
  }

  pin(name: string): () => void {
    this.pins.set(name, (this.pins.get(name) ?? 0) + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const count = this.pins.get(name)!
      if (count === 1) this.pins.delete(name)
      else this.pins.set(name, count - 1)
    }
  }

  async exclusive<T>(name: string, action: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(name) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>(done => {
      release = done
    })
    this.locks.set(name, current)
    await previous
    try {
      return await action()
    } finally {
      release()
      if (this.locks.get(name) === current) this.locks.delete(name)
    }
  }
}
