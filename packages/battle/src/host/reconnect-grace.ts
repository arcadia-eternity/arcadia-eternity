import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { playerId } from '@arcadia-eternity/const'

const windowsSchema = Type.Array(
  Type.Object(
    {
      playerId: Type.String({ minLength: 1 }),
      durationSec: Type.Number({ minimum: 0 }),
      expiresAt: Type.Number({ minimum: 0 }),
    },
    { additionalProperties: false },
  ),
  { maxItems: 2 },
)
export type ReconnectWindow = Static<typeof windowsSchema>[number]

export function readReconnectWindows(input: unknown, roster: readonly playerId[]): ReconnectWindow[] {
  if (!Value.Check(windowsSchema, input)) throw new Error('Invalid reconnect windows')
  const windows = input as ReconnectWindow[]
  if (
    new Set(windows.map(window => window.playerId)).size !== windows.length ||
    windows.some(window => !roster.includes(window.playerId as playerId))
  )
    throw new Error('Reconnect window roster mismatch')
  return windows
}

/** Host disconnect deadlines are independent of the game's decision/animation clocks. */
export class ReconnectGrace {
  private readonly windows = new Map<playerId, ReconnectWindow>()
  private readonly timeouts = new Map<playerId, ReturnType<typeof setTimeout>>()
  private suspended = false

  constructor(private readonly onTimeout: (player: playerId) => void) {}

  start(player: playerId, seconds: number): void {
    const durationSec = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
    const expiresAt = Date.now() + durationSec * 1000
    if (!Number.isFinite(expiresAt)) throw new Error('Reconnect deadline is out of range')
    this.cancel(player)
    const window = { playerId: player, durationSec, expiresAt }
    this.windows.set(player, window)
    if (!this.suspended) this.arm(player, window)
  }
  cancel(player: playerId): void {
    const timeout = this.timeouts.get(player)
    if (timeout !== undefined) clearTimeout(timeout)
    this.timeouts.delete(player)
    this.windows.delete(player)
  }
  snapshot(): ReconnectWindow[] {
    return [...this.windows.values()].map(window => ({ ...window }))
  }
  restore(windows: readonly ReconnectWindow[]): void {
    this.clear()
    this.suspended = true
    for (const window of windows) this.windows.set(window.playerId as playerId, { ...window })
  }
  suspend(): void {
    this.suspended = true
    for (const timeout of this.timeouts.values()) clearTimeout(timeout)
    this.timeouts.clear()
  }
  activate(): void {
    if (!this.suspended) return
    this.suspended = false
    for (const [player, window] of this.windows) this.arm(player, window)
  }
  clear(): void {
    for (const timeout of this.timeouts.values()) clearTimeout(timeout)
    this.timeouts.clear()
    this.windows.clear()
  }
  private arm(player: playerId, window: ReconnectWindow): void {
    if (this.windows.get(player) !== window) return
    const remaining = window.expiresAt - Date.now()
    if (remaining <= 0) {
      this.cancel(player)
      this.onTimeout(player)
    } else
      this.timeouts.set(
        player,
        setTimeout(() => this.arm(player, window), Math.min(remaining, 2 ** 31 - 1)),
      )
  }
}
