import { expect, vi } from 'vitest'
import { expectString, getBattlePlayerIds } from './regression-helpers.js'
import type { PlayerSelection } from '@arcadia-eternity/const'
import { createBattleFromConfig } from '../../data/battle-factory.js'
import type { TeamConfig } from '../../data/team-config.js'
import type { V2DataRepository } from '../../data/v2-data-repository.js'
import { BattleOrchestrator } from '../../orchestrator.js'
import { SelectionSystem } from '../../systems/selection.system.js'
import type { DecisionContext, DecisionPhase } from '../../decision/types.js'

export type GoldenAction = {
  phase: DecisionPhase
  type: 'use-skill' | 'switch-pet' | 'do-nothing'
  skill?: string
  pet?: string
}

export interface GoldenScenario {
  seed: string
  teams: [TeamConfig, TeamConfig]
  actions: Record<string, GoldenAction[]>
}

/** Run the same orchestrator as LocalBattleSystemV2, with awaited scripted decisions.
 * No timer, AI, server, account, network, or wall-clock sleeps are involved.
 */
export async function runGoldenBattle(repo: V2DataRepository, scenario: GoldenScenario) {
  const failures: string[] = []
  const consumed: Record<string, number> = {}
  const decisions: unknown[] = []
  const checkpoints: unknown[] = []
  const triggers: string[] = []
  const battle = createBattleFromConfig(...scenario.teams, repo, {
    seed: scenario.seed,
    allowFaintSwitch: true,
    decision: {
      playerA: { type: 'custom', key: 'script' },
      playerB: { type: 'custom', key: 'script' },
      registry: {
        script: () => ({ capabilities: ['public'], decide }),
      },
    },
  })
  const { world, playerSystem, petSystem, skillSystem, markSystem, statStageSystem } = battle
  const { playerAId, playerBId } = getBattlePlayerIds(world)
  // Resolve random instance IDs to their stable place in the input roster.
  const aliases = new Map<string, string>()
  for (const pid of [playerAId, playerBId]) {
    const player = playerSystem.getOrThrow(world, pid)
    aliases.set(pid, player.name)
    for (const petId of player.petIds) {
      const pet = petSystem.getOrThrow(world, petId)
      aliases.set(petId, `${player.name}/${pet.name}`)
      for (const sid of pet.skillIds) {
        aliases.set(sid, `${player.name}/${pet.name}/${skillSystem.getOrThrow(world, sid).baseSkillId}`)
      }
    }
  }
  function normalize(value: unknown): unknown {
    if (typeof value === 'string') {
      const alias = aliases.get(value)
      if (alias) return alias
      const mark = markSystem.get(world, value)
      if (mark) {
        const label = `${aliases.get(mark.ownerId ?? '') ?? mark.ownerId}/${mark.baseMarkId}`
        aliases.set(value, label)
        return label
      }
      return value
    }
    if (Array.isArray(value)) return value.map(normalize)
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]))
    }
    return value
  }
  function state() {
    return {
      turn: world.state.currentTurn,
      status: world.state.status,
      victor: normalize(world.state.victor ?? null),
      endReason: world.state.endReason ?? null,
      players: [playerAId, playerBId].map(pid => {
        const player = playerSystem.getOrThrow(world, pid)
        return {
          player: normalize(pid),
          rage: playerSystem.getRage(world, pid),
          active: normalize(player.activePetId),
          pets: player.petIds.map(petId => ({
            pet: normalize(petId),
            hp: petSystem.getCurrentHp(world, petId),
            alive: petSystem.isAlive(world, petId),
            stages: Object.fromEntries(
              ['atk', 'def', 'spa', 'spd', 'spe'].map(stat => [
                stat,
                statStageSystem.getStage(world, petId, stat as 'atk' | 'def' | 'spa' | 'spd' | 'spe'),
              ]),
            ),
            marks: markSystem.getMarksOnEntity(world, petId).map(mark => ({
              base: mark.baseMarkId,
              stack: mark.stack,
              duration: mark.duration,
              active: mark.isActive,
            })),
          })),
        }
      }),
    }
  }
  async function decide(ctx: DecisionContext): Promise<PlayerSelection> {
    if (failures.length) throw new Error(failures.join('\n'))
    const side = expectString(normalize(ctx.playerId), 'normalized player ID')
    const index = consumed[side] ?? 0
    const plan = scenario.actions[side]?.[index]
    if (!plan) throw new Error(`Script exhausted: ${side} decision ${index}, state ${JSON.stringify(state())}`)
    expect(plan.phase, `${side} decision ${index}, turn ${JSON.stringify(world.state.currentTurn)}`).toBe(ctx.phase)
    const available = ctx.selectionSystem.getAvailableSelections(world, ctx.playerId)
    const selection = available.find(action => {
      if (action.type !== plan.type) return false
      if (action.type === 'use-skill') return skillSystem.getOrThrow(world, action.skill).baseSkillId === plan.skill
      if (action.type === 'switch-pet') return petSystem.getOrThrow(world, action.pet).name === plan.pet
      return true
    })
    if (!selection) throw new Error(`Unavailable action: ${side} ${JSON.stringify(plan)}`)
    consumed[side] = index + 1
    decisions.push({ turn: world.state.currentTurn, player: side, ...plan })
    return selection
  }
  const events: Array<{ turn: unknown; type: string; data: unknown }> = []
  const unsubscribe = battle.eventBus.onEvent(event => {
    // Only timestamps are discarded; preserve event order and all payload fields.
    events.push({ turn: world.state.currentTurn, type: event.type, data: normalize(event.data) })
  })
  const stopObserving = battle.phaseManager.onExecutionEvent((_world, event) => {
    if (event.transition === 'fail') failures.push(`${event.phase.type}: ${event.error}`)
    if (event.transition === 'commit' && ['battleStart', 'turn', 'battleSwitch'].includes(event.phase.type)) {
      checkpoints.push({ phase: event.phase.type, ...state() })
    }
  })
  const originalFire = battle.effectPipeline.fire.bind(battle.effectPipeline)
  const fireSpy = vi.spyOn(battle.effectPipeline, 'fire').mockImplementation(async (...args) => {
    triggers.push(args[1])
    return originalFire(...args)
  })
  const orchestrator = new BattleOrchestrator(battle, new SelectionSystem(playerSystem, petSystem, skillSystem))
  try {
    await orchestrator.startBattle()
    expect(failures).toEqual([])
    expect(world.state.status).toBe('ended')
    expect(world.state.endReason).toBe('all_pet_fainted')
    for (const [side, actions] of Object.entries(scenario.actions)) {
      expect(consumed[side], `${side}: unused script actions`).toBe(actions.length)
    }
    return { seed: scenario.seed, decisions, events, triggers, checkpoints, final: state() }
  } finally {
    orchestrator.stop()
    fireSpy.mockRestore()
    stopObserving()
    unsubscribe()
    battle.eventBus.clear()
  }
}
