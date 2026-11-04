import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { prepareBattleEnvironment } from './environment.mjs'
import { createNodeBattleWorkerManager } from '@arcadia-eternity/battle/v4/sandbox/node'
export { prepareBattleEnvironment } from './environment.mjs'
import { AttackTargetOpinion, BattleMessageType, TurnContext, UseSkillContext } from '@arcadia-eternity/battle/v4'
/** Existing package scenarios use the default environment with declared dependencies only. */
export async function prepareContentPack(root = process.cwd(), options = {}) {
  root = resolve(root)
  const { default: config } = await import(pathToFileURL(join(root, 'arcadia.config.mjs')).href)
  if (
    !Array.isArray(config?.teams) ||
    config.teams.length !== 2 ||
    config.teams.some(id => typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(id)) ||
    Object.keys(config).some(key => key !== 'teams')
  )
    throw new Error('arcadia.config.mjs must export exactly two project team IDs in teams')
  const prepared = await prepareBattleEnvironment(root, options)
  const { environment } = prepared
  // Four automation sessions, one human preview, and room for their validated replacements.
  const workers = createNodeBattleWorkerManager({ maxBattles: 7 })
  function defaultPlayers() {
    return prepared.loadTeams(config.teams)
  }
  function runtimePlayers(supplied, runtimeIds = false) {
    return (supplied ?? defaultPlayers()).map(player => ({
      ...player,
      id: (runtimeIds ? undefined : player.id) ?? randomBytes(16).toString('base64url').slice(0, 21),
      team: player.team.map(pet => ({
        ...pet,
        id: runtimeIds ? randomBytes(16).toString('base64url').slice(0, 21) : pet.id,
      })),
    }))
  }
  /** Trusted in-process reference helper for direct engine introspection tests only.
   * Reuses validation modules; games and automated previews must use createBattleSession.
   */
  function createBattle(
    seed = 'content-pack-template',
    { ai = false, players: supplied, runtimeIds = false, battleOptions = {} } = {},
  ) {
    const input = runtimePlayers(supplied, runtimeIds)
    const players = environment.content.parsePlayers(input, { aiPlayerIds: ai ? [input[1]?.id] : [] })
    if (players.length !== 2) throw new Error('The demo requires exactly two players')
    const ids = players.flatMap(player => [player.id, ...player.team.map(pet => pet.id)])
    if (new Set(ids).size !== ids.length) throw new Error('玩家和精灵的编号不能重复')
    const battle = environment.content.createBattle(players[0], players[1], {
      ...battleOptions,
      rngSeed: seed,
      timerConfig: battleOptions.timerConfig ?? { enabled: false },
    })
    prepared.track(battle)
    return battle
  }
  async function createBattleSession(
    seed = 'content-pack-template',
    { ai = false, players: supplied, runtimeIds = false, battleOptions = {} } = {},
  ) {
    const players = runtimePlayers(supplied, runtimeIds)
    const system = await workers.create({
      environment: environment.sandbox,
      players,
      aiPlayerIds: ai ? [players[1]?.id] : [],
      options: { ...battleOptions, rngSeed: seed, timerConfig: battleOptions.timerConfig ?? { enabled: false } },
      hostOptions: { teamSelection: battleOptions.teamSelection },
    })
    return system
  }
  return {
    ...prepared,
    createBattle,
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

export function attack(battle) {
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
export function cancelled(error) {
  if (!(error instanceof Error) || error.message !== 'Battle cancelled') throw error
}
export function nextTurn(battle) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe()
      reject(new Error('Battle did not reach its next input boundary'))
    }, 10000)
    const listener = message => {
      if (message.type !== BattleMessageType.TurnAction) return
      clearTimeout(timeout)
      unsubscribe()
      resolve()
    }
    const unsubscribe = () => battle.unregisterListener(listener)
    battle.registerListener(listener)
  })
}
export async function runBattle(battle, onTurn = () => {}) {
  const damage = [],
    failures = []
  battle.registerListener(message => {
    if (message.type === BattleMessageType.Damage) damage.push(message.data.damage)
    if (message.type === BattleMessageType.Error || message.type === BattleMessageType.EffectApplyFail)
      failures.push(message)
    if (message.type === BattleMessageType.TurnEnd) onTurn(battle)
    if (message.type !== BattleMessageType.TurnAction) return
    for (const player of [battle.playerA, battle.playerB]) {
      const selection =
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
