import { describe, expect, test } from 'vitest'
import {
  BattleMessageType,
  BattleStatus,
  Gender,
  type BattleMessage,
  type TimerConfig,
  type playerId,
} from '@arcadia-eternity/const'
import { createBattleFromConfig } from '../data/battle-factory.js'
import { LocalBattleSystemV2 } from '../local-battle.js'
import type { BattleConfig, BattleInstance } from '../game.js'
import { getBattlePlayerIds, getTestRepository, makeTeamConfig } from './helpers/regression-helpers.js'

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
  intervalMs = 25,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await sleep(intervalMs)
  }
  throw new Error(`Timed out after ${timeoutMs}ms`)
}

async function createTimerBattle(
  timerConfig: Partial<TimerConfig>,
  extraConfig: Partial<BattleConfig> = {},
): Promise<{
  system: LocalBattleSystemV2
  battle: BattleInstance
  battleConfig: BattleConfig
  playerAId: string
  playerBId: string
}> {
  const repo = await getTestRepository()
  const teamA = makeTeamConfig('A', 'pet_dilan', ['skill_shuipao', 'skill_paida'], Gender.Male)
  const teamB = makeTeamConfig('B', 'pet_dilan', ['skill_shuipao', 'skill_paida'], Gender.Female)
  const battleConfig: BattleConfig = {
    timerConfig,
    ...extraConfig,
  }
  const battle = createBattleFromConfig(teamA, teamB, repo, battleConfig)
  const system = new LocalBattleSystemV2(battle)
  const { playerAId, playerBId } = getBattlePlayerIds(battle.world)
  return { system, battle, battleConfig, playerAId, playerBId }
}

describe('V2 Timer', () => {
  test('turn timeout triggers auto action and turn executes', async () => {
    const { system } = await createTimerBattle({
      enabled: true,
      turnTimeLimit: 1,
      totalTimeLimit: 60,
      animationPauseEnabled: true,
      maxAnimationDuration: 10_000,
    })

    const timeoutEvents: Array<{ player: string; type: 'turn' | 'total'; autoAction?: string }> = []
    const messages: BattleMessage[] = []
    const unsubTimeout = system.onTimerEvent('timerTimeout', event => {
      timeoutEvents.push({
        player: event.player as string,
        type: event.type,
        autoAction: event.autoAction,
      })
    })
    const unsubMessage = system.BattleEvent(message => {
      messages.push(message)
    })

    try {
      await system.ready()

      await waitFor(
        () => timeoutEvents.some(event => event.type === 'turn'),
        6000,
      )
      await waitFor(
        () => messages.some(message => message.type === BattleMessageType.TurnEnd),
        6000,
      )

      expect(timeoutEvents.some(event => event.type === 'turn')).toBe(true)
      expect(timeoutEvents.some(event => event.type === 'turn' && event.autoAction?.includes('使用技能'))).toBe(true)
      expect(messages.some(message => message.type === BattleMessageType.TurnEnd)).toBe(true)
    } finally {
      unsubTimeout()
      unsubMessage()
      await system.cleanup()
    }
  }, 15_000)

  test('total timeout ends battle with timeout reason', async () => {
    const { system, battle, playerAId } = await createTimerBattle(
      {
        enabled: true,
        turnTimeLimit: 10,
        totalTimeLimit: 1,
        animationPauseEnabled: true,
        maxAnimationDuration: 10_000,
      },
      {
        decision: {
          playerA: { type: 'rule', strategy: 'simple' },
          playerB: { type: 'human' },
        },
      },
    )

    const messages: BattleMessage[] = []
    const unsubMessage = system.BattleEvent(message => {
      messages.push(message)
    })

    try {
      await system.ready()

      await waitFor(async () => {
        const state = await system.getState()
        return state.status === BattleStatus.Ended
      }, 7000)

      const state = await system.getState()
      expect(state.status).toBe(BattleStatus.Ended)
      expect(battle.world.state.victor).toBe(playerAId)
      expect(battle.world.state.endReason).toBe('timeout')
      const battleEndMessage = messages.find(
        (message): message is Extract<BattleMessage, { type: BattleMessageType.BattleEnd }> =>
          message.type === BattleMessageType.BattleEnd,
      )
      expect(battleEndMessage).toBeDefined()
      expect(battleEndMessage?.data.reason).toBe('total_time_timeout')
    } finally {
      unsubMessage()
      await system.cleanup()
    }
  }, 15_000)

  test('animation pauses timer countdown and resumes after end', async () => {
    const { system, playerAId } = await createTimerBattle({
      enabled: true,
      turnTimeLimit: 5,
      totalTimeLimit: 60,
      animationPauseEnabled: true,
      maxAnimationDuration: 10_000,
    })

    try {
      await system.ready()

      await waitFor(async () => {
        const timerState = await system.getPlayerTimerState(playerAId as playerId)
        return timerState !== null
      })

      const before = await system.getPlayerTimerState(playerAId as playerId)
      expect(before).not.toBeNull()

      const animationId = await system.startAnimation('timer-test-animation', 2000, playerAId as playerId)
      await sleep(1300)

      const duringAnimation = await system.getPlayerTimerState(playerAId as playerId)
      expect(duringAnimation).not.toBeNull()

      const pausedDelta = (before?.remainingTurnTime ?? 0) - (duringAnimation?.remainingTurnTime ?? 0)
      expect(pausedDelta).toBeLessThan(0.5)

      await system.endAnimation(animationId, 1300)
      await sleep(1200)

      const afterResume = await system.getPlayerTimerState(playerAId as playerId)
      expect(afterResume).not.toBeNull()
      const resumedDelta = (duringAnimation?.remainingTurnTime ?? 0) - (afterResume?.remainingTurnTime ?? 0)
      expect(resumedDelta).toBeGreaterThan(0.5)
    } finally {
      await system.cleanup()
    }
  }, 15_000)

  test('timer remaining total time survives runtime snapshot restore', async () => {
    const timerConfig: Partial<TimerConfig> = {
      enabled: true,
      turnTimeLimit: 10,
      totalTimeLimit: 12,
      animationPauseEnabled: true,
      maxAnimationDuration: 10_000,
    }

    const first = await createTimerBattle(timerConfig)
    await first.system.ready()
    await sleep(1200)

    const before = await first.system.getPlayerTimerState(first.playerAId as playerId)
    expect(before).not.toBeNull()

    const snapshot = await first.system.createRuntimeSnapshot()
    await first.system.cleanup()

    const second = await createTimerBattle(timerConfig)
    try {
      await second.system.restoreRuntimeSnapshot(snapshot)
      await second.system.ready()
      await sleep(150)
      const restoredIds = getBattlePlayerIds(second.system.world)
      const after = await second.system.getPlayerTimerState(restoredIds.playerAId as playerId)
      expect(after).not.toBeNull()
      expect(after!.remainingTotalTime).toBeLessThan(12)
    } finally {
      await second.system.cleanup()
    }
  }, 20_000)

  test('reconnect grace timer auto-surrenders disconnected player during decision window', async () => {
    const { system, battle, playerAId, playerBId } = await createTimerBattle(
      {
        enabled: true,
        turnTimeLimit: 20,
        totalTimeLimit: 120,
        animationPauseEnabled: true,
        maxAnimationDuration: 10_000,
      },
      {
        decision: {
          playerA: { type: 'rule', strategy: 'simple' },
          playerB: { type: 'human' },
        },
      },
    )

    try {
      await system.ready()
      await system.startReconnectGraceTimer(playerBId as playerId, 0.25)

      await waitFor(async () => {
        const state = await system.getState()
        return state.status === BattleStatus.Ended
      }, 6000)

      const state = await system.getState()
      expect(state.status).toBe(BattleStatus.Ended)
      expect(battle.world.state.victor).toBe(playerAId)
      expect(battle.world.state.endReason).toBe('surrender')
    } finally {
      await system.cleanup()
    }
  }, 15_000)

  test('reconnect grace timer can be cancelled', async () => {
    const { system, playerBId } = await createTimerBattle(
      {
        enabled: true,
        turnTimeLimit: 20,
        totalTimeLimit: 120,
        animationPauseEnabled: true,
        maxAnimationDuration: 10_000,
      },
      {
        decision: {
          playerA: { type: 'rule', strategy: 'simple' },
          playerB: { type: 'human' },
        },
      },
    )

    try {
      await system.ready()
      await system.startReconnectGraceTimer(playerBId as playerId, 0.25)
      await system.cancelReconnectGraceTimer(playerBId as playerId)
      await sleep(800)

      const state = await system.getState()
      expect(state.status).not.toBe(BattleStatus.Ended)
    } finally {
      await system.cleanup()
    }
  }, 12_000)

  test('reconnect grace timer survives runtime snapshot restore', async () => {
    const timerConfig: Partial<TimerConfig> = {
      enabled: true,
      turnTimeLimit: 20,
      totalTimeLimit: 120,
      animationPauseEnabled: true,
      maxAnimationDuration: 10_000,
    }

    const first = await createTimerBattle(timerConfig, {
      decision: {
        playerA: { type: 'rule', strategy: 'simple' },
        playerB: { type: 'human' },
      },
    })
    await first.system.ready()
    await first.system.startReconnectGraceTimer(first.playerBId as playerId, 1.1)
    await sleep(400)

    const snapshot = await first.system.createRuntimeSnapshot()
    await first.system.cleanup()

    const second = await createTimerBattle(timerConfig, {
      decision: {
        playerA: { type: 'rule', strategy: 'simple' },
        playerB: { type: 'human' },
      },
    })
    try {
      await second.system.restoreRuntimeSnapshot(snapshot)
      await second.system.ready()

      await waitFor(async () => {
        const state = await second.system.getState()
        return state.status === BattleStatus.Ended
      }, 8000)

      const restoredIds = getBattlePlayerIds(second.system.world)
      expect(second.battle.world.state.victor).toBe(restoredIds.playerAId)
      expect(second.battle.world.state.endReason).toBe('surrender')
    } finally {
      await second.system.cleanup()
    }
  }, 20_000)

  test('disconnect timeout only triggers after heartbeat renewals stop', async () => {
    const { system, battle, playerAId, playerBId } = await createTimerBattle(
      {
        enabled: true,
        turnTimeLimit: 20,
        totalTimeLimit: 120,
        animationPauseEnabled: true,
        maxAnimationDuration: 10_000,
      },
      {
        decision: {
          playerA: { type: 'rule', strategy: 'simple' },
          playerB: { type: 'human' },
        },
      },
    )

    const renewTimer = setInterval(() => {
      void system.startReconnectGraceTimer(playerBId as playerId, 0.35)
    }, 120)

    try {
      await system.ready()
      await system.startReconnectGraceTimer(playerBId as playerId, 0.35)

      await sleep(1000)
      const midState = await system.getState()
      expect(midState.status).not.toBe(BattleStatus.Ended)

      clearInterval(renewTimer)

      await waitFor(async () => {
        const state = await system.getState()
        return state.status === BattleStatus.Ended
      }, 8000)

      expect(battle.world.state.victor).toBe(playerAId)
      expect(battle.world.state.endReason).toBe('surrender')
    } finally {
      clearInterval(renewTimer)
      await system.cleanup()
    }
  }, 20_000)
})
