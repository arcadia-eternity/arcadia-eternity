// battle/src/v2/__tests__/v2-e2e-yaml.ts
// End-to-end test: load real YAML data → createBattleFromConfig → run full battle.
// Run with: npx tsx packages/battle/src/v2/__tests__/v2-e2e-yaml.ts

import {
  BattleMessageType,
  BattleStatus,
  type BattleMessage,
  type playerId,
} from '@arcadia-eternity/const'
import { loadV2GameDataFromPack } from '../data/v2-data-loader.js'
import { createBattleFromConfig } from '../data/battle-factory.js'
import { LocalBattleSystemV2 } from '../local-battle.js'
import type { TeamConfig } from '../data/team-config.js'

const PACK_REF = 'builtin:base'

const teamA: TeamConfig = {
  name: 'PlayerA',
  team: [
    {
      name: 'Dilan',
      species: 'pet_dilan',
      level: 50,
      evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      nature: 'Hardy',
      skills: ['skill_paida', 'skill_shuipao'],
    },
  ],
}

const teamB: TeamConfig = {
  name: 'PlayerB',
  team: [
    {
      name: 'Dilan2',
      species: 'pet_dilan',
      level: 50,
      evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      nature: 'Hardy',
      skills: ['skill_paida', 'skill_shuipao'],
    },
  ],
}

async function main() {
  console.log('=== V2 End-to-End YAML Test ===\n')

  // Step 1: Load data
  console.log(`Loading data pack: ${PACK_REF}`)
  const { repository, errors } = await loadV2GameDataFromPack(PACK_REF, { continueOnError: true })
  const stats = repository.stats()
  console.log(`Loaded: ${stats.effects} effects, ${stats.marks} marks, ${stats.skills} skills, ${stats.species} species`)
  if (errors.length > 0) {
    console.warn(`Warnings: ${errors.length} (first 3: ${errors.slice(0, 3).join(', ')})`)
  }

  // Step 2: Create battle from config
  console.log('\nCreating battle from team configs...')
  const battle = createBattleFromConfig(teamA, teamB, repository)
  const { world } = battle
  console.log(`PlayerA: ${world.state.playerAId as string}, PlayerB: ${world.state.playerBId as string}`)

  // Step 3: Run battle
  const system = new LocalBattleSystemV2(battle)
  const messages: BattleMessage[] = []
  system.BattleEvent(msg => messages.push(msg))

  await system.ready()
  await sleep(50)

  let turn = 0
  const maxTurns = 50

  while (turn < maxTurns) {
    const state = await system.getState()
    if (state.status === BattleStatus.Ended) {
      console.log(`\nBattle ended after ${turn} turns`)
      break
    }

    turn++
    console.log(`\n--- Turn ${turn} ---`)

    const playerAId = world.state.playerAId as unknown as playerId
    const playerBId = world.state.playerBId as unknown as playerId

    const selA = await system.getAvailableSelection(playerAId)
    const selB = await system.getAvailableSelection(playerBId)

    const skillA = selA.find(s => s.type === 'use-skill') ?? selA[0]
    const skillB = selB.find(s => s.type === 'use-skill') ?? selB[0]

    if (skillA) await system.submitAction(skillA)
    if (skillB) await system.submitAction(skillB)

    await sleep(100)

    const stateAfter = await system.getState()
    for (const p of stateAfter.players) {
      const activePet = p.team?.find(pet => pet.id === p.activePet)
      if (activePet) {
        console.log(`  ${p.name}: ${activePet.name} HP ${activePet.currentHp}/${activePet.maxHp}`)
      }
    }
  }

  // Step 4: Verify results
  const finalState = await system.getState()
  console.log('\n=== Final State ===')
  console.log(`Status: ${finalState.status === BattleStatus.Ended ? 'Ended' : 'Active'}`)
  console.log(`Victor: ${(world.state.victor as string | undefined) ?? 'none'}`)
  console.log(`Reason: ${(world.state.endReason as string | undefined) ?? 'none'}`)
  console.log(`Total messages: ${messages.length}`)

  const msgCounts = new Map<string, number>()
  for (const m of messages) msgCounts.set(m.type, (msgCounts.get(m.type) ?? 0) + 1)
  console.log('Message counts:', Object.fromEntries(msgCounts))

  // Assertions
  let passed = 0, failed = 0
  function assert(cond: boolean, msg: string) {
    if (cond) { passed++; console.log(`  ✓ ${msg}`) }
    else { failed++; console.error(`  ✗ ${msg}`) }
  }

  console.log('\n=== Assertions ===')
  assert(stats.effects > 100, `Loaded ${stats.effects} effects`)
  assert(stats.skills > 100, `Loaded ${stats.skills} skills`)
  assert(stats.species > 10, `Loaded ${stats.species} species`)
  assert(finalState.status === BattleStatus.Ended, 'Battle ended')
  assert(world.state.victor !== undefined, 'Has a victor')
  assert(messages.some(m => m.type === BattleMessageType.BattleStart), 'BattleStart emitted')
  assert(messages.some(m => m.type === BattleMessageType.Damage), 'Damage emitted')
  assert(messages.some(m => m.type === BattleMessageType.BattleEnd), 'BattleEnd emitted')
  assert(turn > 0, `Battle lasted ${turn} turns`)

  console.log(`\n${passed} passed, ${failed} failed`)

  await system.cleanup()
  process.exit(failed > 0 ? 1 : 0)
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

main().catch(e => { console.error(e); process.exit(1) })
