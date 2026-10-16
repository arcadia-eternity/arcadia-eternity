import { beforeAll, describe, expect, test } from 'vitest'
import { Gender } from '@arcadia-eternity/const'
import { createBattleFromConfig } from '../data/battle-factory.js'
import { expectString, getTestRepository, makeTeamConfig } from './helpers/regression-helpers.js'

let rageAfterSwitch: number
beforeAll(async () => {
  const repo = await getTestRepository()
  const teamA = makeTeamConfig('A', 'pet_dilan', ['skill_paida'], Gender.Male)
  teamA.team.push({ ...teamA.team[0], name: 'reserve' })
  const battle = createBattleFromConfig(teamA, makeTeamConfig('B', 'pet_dilan', ['skill_paida'], Gender.Male), repo, {
    seed: 'ae4-switch-rounding',
  })
  const { world, playerSystem, phaseManager, eventBus } = battle
  const pid = expectString(world.state.playerAId, 'playerAId')
  const player = playerSystem.getOrThrow(world, pid)
  playerSystem.setRage(world, pid, 21)
  const result = await phaseManager.execute(world, 'switch', eventBus, {
    context: {
      type: 'switch-pet',
      parentId: 'known-defect',
      originPlayerId: pid,
      switchOutPetId: player.petIds[0],
      switchInPetId: player.petIds[1],
    },
  })
  // Setup failures fail the suite normally; only the numeric semantic assertion is xfail.
  expect(result.success).toBe(true)
  expect(player.activePetId).toBe(player.petIds[1])
  rageAfterSwitch = playerSystem.getRage(world, pid)
})

describe('known V2 defects: intended V1 semantics, excluded from golden acceptance', () => {
  // V1 c0862898 phase/switch.ts: player.settingRage(Math.floor(player.currentRage * 0.8)).
  // An unexpected pass goes red: remove test.fails when the defect is fixed.
  test.fails('V2-201-01: switching at 21 rage should leave floor(21 * 0.8) = 16', () => {
    expect(rageAfterSwitch).toBe(16)
  })
})

let outgoingHpAfterAttack: number
let outgoingHpBeforeAttack: number
beforeAll(async () => {
  const repo = await getTestRepository()
  const teamA = makeTeamConfig('A', 'pet_dilan', ['skill_paida'], Gender.Male)
  teamA.team.push({ ...teamA.team[0], name: 'reserve' })
  const battle = createBattleFromConfig(teamA, makeTeamConfig('B', 'pet_dilan', ['skill_paida'], Gender.Male), repo, {
    seed: 'ae4-switch-target',
  })
  const { world, playerSystem, petSystem, phaseManager, eventBus } = battle
  const a = playerSystem.getOrThrow(world, expectString(world.state.playerAId, 'playerAId'))
  const b = playerSystem.getOrThrow(world, expectString(world.state.playerBId, 'playerBId'))
  outgoingHpBeforeAttack = petSystem.getCurrentHp(world, a.petIds[0])
  const result = await phaseManager.execute(world, 'turn', eventBus, {
    selections: {
      [a.id]: { player: a.id, type: 'switch-pet', pet: a.petIds[1] },
      [b.id]: {
        player: b.id,
        type: 'use-skill',
        skill: petSystem.getOrThrow(world, b.petIds[0]).skillIds[0],
        target: 'opponent',
      },
    },
  })
  expect(result.success).toBe(true)
  expect(a.activePetId).toBe(a.petIds[1])
  expect(world.eventLog.some(event => event.type === 'damage')).toBe(true)
  outgoingHpAfterAttack = petSystem.getCurrentHp(world, a.petIds[0])
})

// V1 phase/skill.ts calls context.updateActualTarget() immediately before use checks.
test.fails('V2-201-02: an opponent attack after a switch should leave the outgoing pet unharmed', () => {
  expect(outgoingHpAfterAttack).toBe(outgoingHpBeforeAttack)
})

let rageAfterTurnWithFaintedLead: number
beforeAll(async () => {
  const repo = await getTestRepository()
  const teamA = makeTeamConfig('A', 'pet_dilan', ['skill_paida'], Gender.Male)
  teamA.team.push({ ...teamA.team[0], name: 'reserve' })
  const battle = createBattleFromConfig(teamA, makeTeamConfig('B', 'pet_dilan', ['skill_paida'], Gender.Male), repo, {
    seed: 'ae4-faint-turn-rage',
  })
  const { world, playerSystem, petSystem, phaseManager, eventBus } = battle
  const a = playerSystem.getOrThrow(world, expectString(world.state.playerAId, 'playerAId'))
  const b = playerSystem.getOrThrow(world, expectString(world.state.playerBId, 'playerBId'))
  petSystem.setCurrentHp(world, a.activePetId, 0)
  expect(playerSystem.getAlivePets(world, a.id)).toHaveLength(1)
  const result = await phaseManager.execute(world, 'turn', eventBus, {
    selections: {
      [a.id]: { player: a.id, type: 'do-nothing' },
      [b.id]: { player: b.id, type: 'do-nothing' },
    },
  })
  expect(result.success).toBe(true)
  rageAfterTurnWithFaintedLead = playerSystem.getRage(world, a.id)
})

// V1 phase/turn.ts addTurnRage applies to both players before faint replacement.
test.fails('V2-201-03: a player with a fainted lead still gains turn rage before replacement', () => {
  expect(rageAfterTurnWithFaintedLead).toBe(35)
})
