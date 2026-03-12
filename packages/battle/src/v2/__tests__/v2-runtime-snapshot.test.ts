import { describe, expect, test } from 'vitest'
import { BattleMessageType, BattleStatus, Gender, type BattleMessage, type playerId } from '@arcadia-eternity/const'
import { createBattleFromConfig } from '../data/battle-factory.js'
import { LocalBattleSystemV2 } from '../local-battle.js'
import { getBattlePlayerIds, getTestRepository, makeTeamConfig } from './helpers/regression-helpers.js'

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForAsync(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 3000,
  intervalMs = 20,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await condition()) return
    await sleep(intervalMs)
  }
  throw new Error(`Timed out waiting for condition in ${timeoutMs}ms`)
}

async function waitForSelections(system: LocalBattleSystemV2, playerAId: string, playerBId: string): Promise<void> {
  await waitForAsync(async () => {
    const state = await system.getState()
    if (state.status === BattleStatus.Ended) return true
    const selectionsA = await system.getAvailableSelection(playerAId as playerId)
    const selectionsB = await system.getAvailableSelection(playerBId as playerId)
    return selectionsA.length > 0 && selectionsB.length > 0
  })
}

describe('V2 runtime snapshot', () => {
  test('restores pending snapshot and runs battle start flow', async () => {
    const repo = await getTestRepository()
    const teamA = makeTeamConfig('A', 'pet_dilan', ['skill_shuipao', 'skill_paida'], Gender.Male)
    const teamB = makeTeamConfig('B', 'pet_dilan', ['skill_shuipao', 'skill_paida'], Gender.Female)

    const battle1 = createBattleFromConfig(teamA, teamB, repo, { seed: 'snapshot-seed-pending-1' })
    const system1 = new LocalBattleSystemV2(battle1)
    const snapshot = await system1.createRuntimeSnapshot()
    await system1.cleanup()

    const battle2 = createBattleFromConfig(teamA, teamB, repo, { seed: 'snapshot-seed-pending-2' })
    const system2 = new LocalBattleSystemV2(battle2)
    const messages2: BattleMessage[] = []
    system2.BattleEvent(msg => messages2.push(msg))
    await system2.restoreRuntimeSnapshot(snapshot)
    await system2.ready()

    await waitForAsync(() => messages2.some(msg => msg.type === BattleMessageType.BattleStart), 3000)
    expect(messages2.some(msg => msg.type === BattleMessageType.BattleStart)).toBe(true)
    await system2.cleanup()
  }, 20_000)

  test('restores runtime snapshot and resumes loop without replaying battle start', async () => {
    const repo = await getTestRepository()
    const teamA = makeTeamConfig('A', 'pet_dilan', ['skill_shuipao', 'skill_paida'], Gender.Male)
    const teamB = makeTeamConfig('B', 'pet_dilan', ['skill_shuipao', 'skill_paida'], Gender.Female)

    // Snapshot an already-started world state so restore path should skip battleStart.
    const battle1 = createBattleFromConfig(teamA, teamB, repo, { seed: 'snapshot-seed-1' })
    const system1 = new LocalBattleSystemV2(battle1)
    battle1.world.state.status = 'active'
    const snapshot = await system1.createRuntimeSnapshot()
    await system1.cleanup()

    // Restore on a fresh runtime and resume.
    const battle2 = createBattleFromConfig(teamA, teamB, repo, { seed: 'snapshot-seed-2' })
    const system2 = new LocalBattleSystemV2(battle2)
    const messages2: BattleMessage[] = []
    system2.BattleEvent(msg => messages2.push(msg))
    await system2.restoreRuntimeSnapshot(snapshot)
    await system2.ready()

    await sleep(80)
    expect(messages2.some(msg => msg.type === BattleMessageType.BattleStart)).toBe(false)

    const ids2 = getBattlePlayerIds(battle2.world)
    await waitForSelections(system2, ids2.playerAId, ids2.playerBId)

    const selectionsA = await system2.getAvailableSelection(ids2.playerAId as playerId)
    const selectionsB = await system2.getAvailableSelection(ids2.playerBId as playerId)
    const actionA = selectionsA[0]
    const actionB = selectionsB[0]
    expect(actionA).toBeDefined()
    expect(actionB).toBeDefined()
    await system2.submitAction(actionA!)
    await system2.submitAction(actionB!)

    await sleep(80)
    const state2 = await system2.getState()
    expect([BattleStatus.OnBattle, BattleStatus.Ended]).toContain(state2.status)
    await system2.cleanup()
  }, 20_000)
})
