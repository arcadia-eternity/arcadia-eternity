// engine/src/events.ts
// Simple synchronous event system for message broadcasting.
// Events are also logged to world.eventLog for replay / serialization.

import type { World } from './world.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GameEvent {
  type: string
  data: Record<string, unknown>
  timestamp: number
}

export type EventHandler = (event: GameEvent) => void

// ---------------------------------------------------------------------------
// EventBus
// ---------------------------------------------------------------------------

export class EventBus {
  private handlers: EventHandler[] = []
  private typeHandlers = new Map<string, EventHandler[]>()

  /**
   * Emit an event. Synchronously calls all handlers and appends to world log.
   */
  emit(world: World, type: string, data: Record<string, unknown> = {}): void {
    const event: GameEvent = {
      type,
      data,
      timestamp: Date.now(),
    }

    // Append to world event log
    world.eventLog.push(event)

    // Notify global handlers
    for (const handler of this.handlers) {
      handler(event)
    }

    // Notify type-specific handlers
    const typed = this.typeHandlers.get(type)
    if (typed) {
      for (const handler of typed) {
        handler(event)
      }
    }
  }

  /**
   * Subscribe to all events. Returns an unsubscribe function.
   */
  onEvent(handler: EventHandler): () => void {
    this.handlers.push(handler)
    return () => {
      const idx = this.handlers.indexOf(handler)
      if (idx !== -1) this.handlers.splice(idx, 1)
    }
  }

  /**
   * Subscribe to events of a specific type. Returns an unsubscribe function.
   */
  on(type: string, handler: EventHandler): () => void {
    if (!this.typeHandlers.has(type)) {
      this.typeHandlers.set(type, [])
    }
    this.typeHandlers.get(type)!.push(handler)
    return () => {
      const handlers = this.typeHandlers.get(type)
      if (handlers) {
        const idx = handlers.indexOf(handler)
        if (idx !== -1) handlers.splice(idx, 1)
      }
    }
  }

  /**
   * Remove all handlers.
   */
  clear(): void {
    this.handlers.length = 0
    this.typeHandlers.clear()
  }
}
