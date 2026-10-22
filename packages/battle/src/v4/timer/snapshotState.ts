import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { TimerState, type playerId } from '@arcadia-eternity/const'

const nonnegative = Type.Number({ minimum: 0 })
const remaining = Type.Union([nonnegative, Type.Null()])
const config = Type.Object(
  {
    enabled: Type.Boolean(),
    turnTimeLimit: Type.Optional(nonnegative),
    totalTimeLimit: Type.Optional(nonnegative),
    animationPauseEnabled: Type.Boolean(),
    maxAnimationDuration: nonnegative,
  },
  { additionalProperties: false },
)
const clock = Type.Object(
  {
    playerId: Type.String({ minLength: 1 }),
    config,
    state: Type.Enum(TimerState),
    remainingTurnTime: remaining,
    remainingTotalTime: remaining,
    lastUpdateTime: nonnegative,
    pauseStartTime: Type.Optional(nonnegative),
    totalPausedTime: nonnegative,
    lastEmittedState: Type.Enum(TimerState),
    lastSnapshotTime: nonnegative,
    pauseReason: Type.Optional(Type.Union([Type.Literal('animation'), Type.Literal('system')])),
  },
  { additionalProperties: false },
)
const runtime = Type.Object(
  {
    version: Type.Literal(1),
    capturedAt: nonnegative,
    phase: Type.Union([Type.Literal('selection'), Type.Literal('execution'), Type.Literal('switch'), Type.Null()]),
    active: Type.Boolean(),
    selections: Type.Array(Type.Tuple([Type.String({ minLength: 1 }), Type.Boolean()]), { maxItems: 2 }),
    players: Type.Array(clock, { minItems: 2, maxItems: 2 }),
  },
  { additionalProperties: false },
)

export type SavedBattleTimer = Static<typeof clock>
export type SavedTimerRuntime = Static<typeof runtime>

/** Validate data and roster references before creating any interval or host callback. */
export function readTimerRuntime(
  input: unknown,
  roster: readonly { id: playerId; selected: boolean }[],
): SavedTimerRuntime {
  if (!Value.Check(runtime, input)) throw new Error('Invalid timer runtime snapshot')
  const saved = input as SavedTimerRuntime
  const ids = new Set(roster.map(player => player.id as string))
  if (
    ids.size !== roster.length ||
    saved.players.some(player => !ids.has(player.playerId)) ||
    new Set(saved.players.map(player => player.playerId)).size !== ids.size
  )
    throw new Error('Timer snapshot roster mismatch')
  if (
    new Set(saved.selections.map(([id]) => id)).size !== saved.selections.length ||
    saved.selections.some(([id, selected]) => roster.find(player => player.id === id)?.selected !== selected)
  )
    throw new Error('Timer selection state disagrees with Battle')
  if (saved.phase === 'selection' && saved.selections.length !== ids.size)
    throw new Error('Incomplete timer selection state')
  for (const player of saved.players)
    if (
      !player.config.enabled ||
      (player.remainingTurnTime === null && player.config.turnTimeLimit) ||
      (player.remainingTotalTime === null && player.config.totalTimeLimit)
    )
      throw new Error('Timer snapshot limit mismatch')
  return saved
}
