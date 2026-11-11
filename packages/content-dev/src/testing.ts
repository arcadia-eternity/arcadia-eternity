import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { prepareBattleEnvironment } from './environment.ts'
import { assertEnvironmentTeam, validateEnvironmentRules } from './environment-rules.ts'
import { playersFromTeams } from './project-teams.ts'
import { prepareSandboxContent, type SandboxContent } from '@arcadia-eternity/battle/sandbox/effects'
import { createNodeBattleWorkerManager } from '@arcadia-eternity/battle/sandbox/node'
import type { Battle } from '@arcadia-eternity/battle/engine'
import { isRecord } from './types.ts'
export { prepareBattleEnvironment } from './environment.ts'
import { AttackTargetOpinion, BattleMessageType, TurnContext, UseSkillContext } from '@arcadia-eternity/battle/engine'
export {
  AttackTargetOpinion,
  EffectContext,
  EffectTrigger,
  RemoveMarkContext,
  parameterAddress,
  setGlobalLogger,
} from '@arcadia-eternity/battle/engine'

type BattleListener = Parameters<Battle['registerListener']>[0]
type BattleMessage = Parameters<BattleListener>[0]
type PlayerSelection = Parameters<Battle['setSelection']>[0]

/** Existing package scenarios use the default environment with declared dependencies only. */
export async function prepareContentPack(
  root: string = process.cwd(),
  options: NonNullable<Parameters<typeof prepareBattleEnvironment>[1]> = {},
) {
  root = resolve(root)
  const { default: config }: { default: unknown } = await import(pathToFileURL(join(root, 'arcadia.config.mjs')).href)
  if (
    !isRecord(config) ||
    !Array.isArray(config.teams) ||
    config.teams.length !== 2 ||
    config.teams.some((id: unknown) => typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(id)) ||
    Object.keys(config).some(key => key !== 'teams')
  )
    throw new Error('arcadia.config.mjs must export exactly two project team IDs in teams')
  const teams = (config as { teams: string[] }).teams
  const prepared = await prepareBattleEnvironment(root, options)
  const { environment } = prepared
  const environmentRules = validateEnvironmentRules(prepared.environmentDocument.rules)
  // Four automation sessions, one human preview, and room for their validated replacements.
  const workers = createNodeBattleWorkerManager({ maxBattles: 7 })
  function defaultPlayers() {
    return prepared.loadTeams(teams)
  }
  function runtimePlayers(supplied?: readonly unknown[], runtimeIds = false) {
    const players = ((supplied ?? defaultPlayers()) as unknown as ReturnType<typeof playersFromTeams>).map(player => ({
      ...player,
      id: (runtimeIds ? undefined : player.id) ?? randomBytes(16).toString('base64url').slice(0, 21),
      team: player.team.map(pet => ({
        ...pet,
        id: runtimeIds ? randomBytes(16).toString('base64url').slice(0, 21) : pet.id,
      })),
    }))
    for (const player of players) assertEnvironmentTeam(environmentRules, player.team)
    return players
  }
  const referenceContent = new WeakMap<Battle, SandboxContent['content']>()
  function ownBattle(battle: Battle, effects: SandboxContent): Battle {
    referenceContent.set(battle, effects.content)
    const cleanup = battle.cleanup.bind(battle)
    // Keep the runtime method non-enumerable, like the prototype method: only
    // domain fields belong in snapshots, never this resource-owner callback.
    Object.defineProperty(battle, 'cleanup', {
      configurable: true,
      value: async () => {
        try {
          await cleanup()
        } finally {
          effects.dispose()
        }
      },
    })
    prepared.track(battle)
    return battle
  }
  /** Explicit trusted introspection entry. Every reference battle owns fresh VMs,
   * just like the Worker entry; preparing an environment never evaluates effects.
   */
  async function createBattle(
    seed: string = 'content-pack-template',
    {
      ai = false,
      players: supplied,
      runtimeIds = false,
      battleOptions = {},
    }: {
      ai?: boolean
      players?: readonly unknown[]
      runtimeIds?: boolean
      battleOptions?: Record<string, unknown>
    } = {},
  ): Promise<Battle> {
    const input = runtimePlayers(supplied, runtimeIds)
    const effects = await prepareSandboxContent(environment.sandbox)
    try {
      const players = effects.content.parsePlayers(input, {
        aiPlayerIds: ai && input[1] ? [input[1].id] : [],
      })
      if (players.length !== 2) throw new Error('The demo requires exactly two players')
      const ids = players.flatMap(player => [player.id, ...player.team.map(pet => pet.id)])
      if (new Set(ids).size !== ids.length) throw new Error('玩家和精灵的编号不能重复')
      return ownBattle(
        effects.content.createBattle(players[0], players[1], {
          ...battleOptions,
          rngSeed: seed,
          timerConfig: battleOptions.timerConfig ?? { enabled: false },
        } as Parameters<typeof effects.content.createBattle>[2]),
        effects,
      )
    } catch (error) {
      effects.dispose()
      throw error
    }
  }
  async function restoreBattle(snapshot: unknown): Promise<Battle> {
    const effects = await prepareSandboxContent(environment.sandbox)
    try {
      return ownBattle(effects.content.restore(snapshot), effects)
    } catch (error) {
      effects.dispose()
      throw error
    }
  }
  function contentFor(battle: Battle): SandboxContent['content'] {
    const content = referenceContent.get(battle)
    if (!content) throw new Error('Battle does not belong to this reference helper')
    return content
  }
  async function createBattleSession(
    seed: string = 'content-pack-template',
    {
      ai = false,
      players: supplied,
      runtimeIds = false,
      battleOptions = {},
    }: {
      ai?: boolean
      players?: readonly unknown[]
      runtimeIds?: boolean
      battleOptions?: Record<string, unknown>
    } = {},
  ) {
    const players = runtimePlayers(supplied, runtimeIds)
    const system = await workers.create({
      environment: environment.sandbox,
      players,
      aiPlayerIds: ai ? [players[1]?.id] : [],
      options: { ...battleOptions, rngSeed: seed, timerConfig: battleOptions.timerConfig ?? { enabled: false } },
      hostOptions: { teamSelection: battleOptions.teamSelection },
    } as Parameters<typeof workers.create>[0])
    return system
  }
  return {
    ...prepared,
    createBattle,
    restoreBattle,
    contentFor,
    createBattleSession,
    defaultPlayers,
    async dispose() {
      try {
        await workers.dispose()
      } finally {
        await prepared.dispose()
      }
    },
  }
}

export function attack(battle: Battle) {
  const player = battle.playerA
  const context = new UseSkillContext(
    new TurnContext(battle),
    player,
    player.activePet,
    AttackTargetOpinion.opponent,
    player.activePet.skills[0],
  )
  context.updateActualTarget()
  return context
}
export function cancelled(error: unknown) {
  if (!(error instanceof Error) || error.message !== 'Battle cancelled') throw error
}
export function nextTurn(battle: Battle): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe()
      reject(new Error('Battle did not reach its next input boundary'))
    }, 10000)
    const listener = (message: BattleMessage) => {
      if (message.type !== BattleMessageType.TurnAction) return
      clearTimeout(timeout)
      unsubscribe()
      resolve()
    }
    const unsubscribe = () => battle.unregisterListener(listener)
    battle.registerListener(listener)
  })
}
export async function runBattle(battle: Battle, onTurn: (battle: Battle) => void = () => {}) {
  const damage: number[] = [],
    failures: BattleMessage[] = []
  battle.registerListener((message: BattleMessage) => {
    if (message.type === BattleMessageType.Damage) damage.push(message.data.damage)
    if (message.type === BattleMessageType.Error || String(message.type) === BattleMessageType.EffectApplyFail)
      failures.push(message)
    if (message.type === BattleMessageType.TurnEnd) onTurn(battle)
    if (message.type !== BattleMessageType.TurnAction) return
    for (const player of [battle.playerA, battle.playerB]) {
      const selection: PlayerSelection =
        battle.currentTurn >= 40
          ? { type: 'surrender', player: player.id }
          : {
              type: 'use-skill',
              player: player.id,
              skill: player.activePet.skills[0].id,
              target: AttackTargetOpinion.opponent,
            }
      if (!battle.setSelection(selection)) throw new Error('Example selection rejected')
      if (selection.type === 'surrender') break
    }
  })
  await battle.startBattle()
  assert.deepEqual(failures, [], 'the demonstration must not hide effect execution failures')
  assert.ok(battle.currentTurn < 40, 'the demonstration should finish by defeating the opposing pet')
  return {
    winner: battle.victor?.name,
    turns: battle.currentTurn,
    hp: [battle.playerA, battle.playerB].map(player => player.activePet.currentHp),
    damage,
  }
}
