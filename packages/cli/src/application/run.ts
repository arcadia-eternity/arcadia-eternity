import { setImmediate as nextTick } from 'node:timers/promises'
import { randomBytes } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import {
  BattleMessageType,
  type BattleMessage,
  type BattleState,
  type PlayerSelection,
  type playerId,
} from '@arcadia-eternity/const'
import { GameRng, ExecutionBudgetExceeded } from '@arcadia-eternity/battle/v4'
import { LocalBattleSystemV4 } from '@arcadia-eternity/battle/v4/host'
import type { NativeContentResult } from '@arcadia-eternity/pack-loader/native'
import type { BattleRuntimeSnapshot } from '@arcadia-eternity/interface'
import { CliError, message } from '../reporting/errors'
import type { RunSpec, RunResult, RecordedInput } from './types'
import { initialFingerprint } from './initial'
import { inputCodec } from './inputs'

const freshId = () => randomBytes(16).toString('base64url').slice(0, 21)
export interface RunOptions {
  signal: AbortSignal
  replay?: { initial: BattleRuntimeSnapshot; inputs: RecordedInput[] }
  humans?: number[]
  captureReplay?: boolean
  present?: (system: LocalBattleSystemV4, ids: playerId[]) => Promise<{ cleanup(): void; failure?: Promise<never> }>
}

/** Drive only the host's settled decisions. Native Battle remains the sole phase executor. */
export async function runBattle(content: NativeContentResult['content'], spec: RunSpec, options: RunOptions) {
  const teams = spec.teams.map(team => ({
    ...structuredClone(team),
    id: freshId(),
    team: team.team.map(pet => ({ ...structuredClone(pet), id: freshId() })),
  }))
  const [a, b] = content.parsePlayers(teams)
  const battle = content.createBattle(a, b, {
    rngSeed: spec.seed,
    showHidden: true,
    allowFaintSwitch: true,
    timerConfig: { enabled: false },
  })
  const aiSeeds = [0, 1].map(seat => `${spec.seed}/ai/${seat}`)
  const rngs = aiSeeds.map(seed => new GameRng(seed))
  let status: RunResult['status'], reason: string, failure: RunResult['error']
  let end: Extract<BattleMessage, { type: BattleMessageType.BattleEnd }>['data'] | undefined
  let presentation: { cleanup(): void; failure?: Promise<never> } | undefined
  let wake = () => {}
  const cancelled = new Promise<'cancelled'>(resolve => {
    wake = () => resolve('cancelled')
    options.signal.addEventListener('abort', wake, { once: true })
  })
  const inputs: RecordedInput[] = []
  let initial: BattleRuntimeSnapshot | undefined
  let completion: Promise<'finished'> | undefined
  let initialState = battle.getState(undefined, true)
  let finalState: BattleState
  let currentBattle = battle
  // A restored host owns a newly hydrated Battle; retain a read-only state source for final reporting.
  const hostContent = {
    snapshot: content.snapshot,
    restore(data: unknown) {
      currentBattle = content.restore(data)
      return currentBattle
    },
  }
  // Use the same restoration hook for initial records and subsequent driver reads.
  const runtime = new LocalBattleSystemV4(battle, hostContent, {
    teamSelection: { enabled: spec.teamSelection, config: { timeLimit: 0 } },
  })
  const unsubscribe = runtime.BattleEvent(event => {
    if (event.type === BattleMessageType.BattleEnd) end = event.data
  })
  try {
    if (options.replay) {
      const expected = initialFingerprint(battle, await runtime.createRuntimeSnapshot())
      await runtime.restoreRuntimeSnapshot(options.replay.initial)
      if (!isDeepStrictEqual(expected, initialFingerprint(currentBattle, await runtime.createRuntimeSnapshot())))
        throw new CliError(
          'REPLAY_INITIAL',
          'Saved checkpoint does not match effective initial teams, configuration or seed',
          3,
        )
    }
    initialState = await runtime.getState(undefined, true)
    const codec = inputCodec(initialState)
    if (options.captureReplay || options.replay) initial = await runtime.createRuntimeSnapshot()
    runtime.onInputAccepted(({ selection, turn, phase }) => {
      inputs.push(codec.encode(selection, turn, phase))
    })
    presentation = await options.present?.(
      runtime,
      initialState.players.filter((_, seat) => options.humans?.includes(seat)).map(player => player.id),
    )
    if (options.signal.aborted) {
      status = 'cancelled'
      reason = 'INTERRUPTED'
    } else {
      await runtime.ready()
      completion = runtime.waitForCompletion().then(() => 'finished' as const)
      // Attach immediately: failures can arrive while waiting for human input or the next boundary.
      void completion.catch(() => undefined)
      while (true) {
        await nextTick()
        if (options.signal.aborted) {
          status = 'cancelled'
          reason = 'INTERRUPTED'
          break
        }
        const outcome = await Promise.race([
          runtime.waitForPendingDecision(),
          completion,
          cancelled,
          ...(presentation?.failure ? [presentation.failure] : []),
        ])
        if (outcome === 'cancelled') {
          status = 'cancelled'
          reason = 'INTERRUPTED'
          break
        }
        if (outcome === 'finished' || end) {
          status = 'completed'
          reason = end?.reason ?? 'finished'
          break
        }
        if (outcome.turn >= spec.maxTurns || inputs.length >= spec.maxActions) {
          status = 'truncated'
          reason = outcome.turn >= spec.maxTurns ? 'MAX_TURNS' : 'MAX_ACTIONS'
          break
        }
        const pending = outcome.selections
          .map((choices, seat) => ({ choices, seat }))
          .filter(entry => entry.choices.length > 0)
        if (options.replay) {
          const input = options.replay.inputs[inputs.length]
          if (!input)
            throw new CliError(
              'REPLAY_INPUT_MISSING',
              `Missing input at action ${inputs.length}, turn ${outcome.turn}`,
              3,
            )
          const choices = outcome.selections[input.seat]
          if (input.turn !== outcome.turn || input.phase !== outcome.phase || !choices?.length)
            throw new CliError(
              'REPLAY_BOUNDARY',
              `Input ${inputs.length} does not match pending turn ${outcome.turn} / ${outcome.phase}`,
              3,
            )
          const action = codec.decode(input)
          if (!choices.some(choice => isDeepStrictEqual(choice, action)))
            throw new CliError('REPLAY_ACTION', `Illegal input at action ${inputs.length}`, 3)
          await runtime.submitAction(action)
        } else {
          let submitted = false
          for (const { choices, seat } of pending) {
            if (options.humans?.includes(seat)) continue
            if (inputs.length >= spec.maxActions) break
            const skills = choices.filter(choice => choice.type === 'use-skill')
            const candidates = skills.length ? skills : choices.filter(choice => choice.type !== 'surrender')
            if (!candidates.length) throw new Error('No non-surrender legal action')
            const action: PlayerSelection = candidates[rngs[seat].nextInt(0, candidates.length - 1)]
            await runtime.submitAction(action)
            submitted = true
          }
          if (!submitted) {
            // Human controllers own the current input. Wake on the next native prompt/end or cancellation.
            let stop = () => {}
            const event = new Promise<void>(resolve => {
              const stopEvent = runtime.BattleEvent(() => resolve())
              const stopInput = runtime.onInputAccepted(() => resolve())
              stop = () => {
                stopEvent()
                stopInput()
              }
            })
            try {
              await Promise.race([
                event,
                completion,
                cancelled,
                ...(presentation?.failure ? [presentation.failure] : []),
              ])
            } finally {
              stop()
            }
          }
        }
      }
      await nextTick()
      if (status === 'completed') await completion
      if (options.replay && inputs.length !== options.replay.inputs.length)
        throw new CliError('REPLAY_INPUT_UNUSED', `Unused inputs after action ${inputs.length}`, 3)
    }
  } catch (error) {
    if (error instanceof CliError && options.replay) throw error
    status = 'failed'
    reason = error instanceof ExecutionBudgetExceeded ? 'KERNEL_BUDGET' : 'RUNTIME_FAILED'
    failure = { code: reason, message: message(error) }
  } finally {
    unsubscribe()
    options.signal.removeEventListener('abort', wake)
    presentation?.cleanup()
    finalState = currentBattle.getState(undefined, true)
    await runtime.cleanup()
    await completion?.catch(() => undefined)
  }
  const rosters = inputCodec(initialState).rosters
  const state = finalState
  const result: RunResult = {
    seed: spec.seed,
    aiSeeds,
    strategy: 'legal-skills-v1',
    status,
    turns: state.currentTurn,
    actions: inputs.length,
    winner:
      status === 'completed' && end?.winner
        ? initialState.players.findIndex(player => player.id === end!.winner)
        : null,
    reason,
    ...(failure ? { error: failure } : {}),
    players: state.players.map((player, seat) => ({
      seat,
      rage: player.rage,
      active: rosters[seat].findIndex(pet => pet.id === player.activePet),
      team: (player.team ?? []).map(pet => ({
        slot: rosters[seat].findIndex(original => original.id === pet.id),
        species: pet.speciesID,
        hp: pet.currentHp,
        maxHp: pet.maxHp,
      })),
    })),
  }
  return { result, initial, inputs }
}
