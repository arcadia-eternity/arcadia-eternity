// Simple v2 battle test
import {
  Nature, Element, Category, AttackTargetOpinion,
  IgnoreStageStrategy, BattleStatus, type playerId,
} from '@arcadia-eternity/const'
import { createBattle } from './packages/battle/src/v2/game.js'
import { LocalBattleSystemV2 } from './packages/battle/src/v2/local-battle.js'
import { createBattleState } from './packages/battle/src/v2/types/battle-state.js'
import { createEntity, setComponent } from '@arcadia-eternity/engine'
import type { SpeciesData } from './packages/battle/src/v2/schemas/species.schema.js'
import type { BaseSkillData } from './packages/battle/src/v2/schemas/skill.schema.js'

// --- Test data ---
const speciesA: SpeciesData = {
  type: 'species', id: 'species_a', num: 1,
  element: Element.Fire,
  baseStats: { hp: 100, atk: 120, def: 80, spa: 60, spd: 60, spe: 90 },
  genderRatio: [50, 50], heightRange: [50, 100], weightRange: [20, 40],
  abilityIds: [], emblemIds: [],
}
const speciesB: SpeciesData = {
  type: 'species', id: 'species_b', num: 2,
  element: Element.Water,
  baseStats: { hp: 100, atk: 80, def: 100, spa: 80, spd: 80, spe: 70 },
  genderRatio: [50, 50], heightRange: [50, 100], weightRange: [20, 40],
  abilityIds: [], emblemIds: [],
}
const baseSkillA: BaseSkillData = {
  type: 'baseSkill', id: 'skill_a', category: Category.Physical,
  element: Element.Fire, power: 80, accuracy: 100, rage: 0, priority: 0,
  target: AttackTargetOpinion.opponent, multihit: 1,
  sureHit: true, sureCrit: false, ignoreShield: false,
  ignoreOpponentStageStrategy: IgnoreStageStrategy.none,
  tags: [], effectIds: [],
}
const baseSkillB: BaseSkillData = {
  type: 'baseSkill', id: 'skill_b', category: Category.Special,
  element: Element.Water, power: 80, accuracy: 100, rage: 0, priority: 0,
  target: AttackTargetOpinion.opponent, multihit: 1,
  sureHit: true, sureCrit: false, ignoreShield: false,
  ignoreOpponentStageStrategy: IgnoreStageStrategy.none,
  tags: [], effectIds: [],
}

// --- Setup battle ---
console.log('Creating battle...')
const battle = createBattle({ seed: '12345' })
const { world, petSystem, skillSystem, playerSystem } = battle

// Register species
createEntity(world, speciesA.id, ['species'])
setComponent(world, speciesA.id, 'species', speciesA)
createEntity(world, speciesB.id, ['species'])
setComponent(world, speciesB.id, 'species', speciesB)

// Register base skills
createEntity(world, baseSkillA.id, ['baseSkill'])
setComponent(world, baseSkillA.id, 'baseSkill', baseSkillA)
createEntity(world, baseSkillB.id, ['baseSkill'])
setComponent(world, baseSkillB.id, 'baseSkill', baseSkillB)

// Create pets
const petA = petSystem.create(world, speciesA, {
  name: 'FirePet', speciesId: speciesA.id, level: 50,
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  nature: Nature.Hardy, baseSkillIds: [],
})
const petB = petSystem.create(world, speciesB, {
  name: 'WaterPet', speciesId: speciesB.id, level: 50,
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  nature: Nature.Hardy, baseSkillIds: [],
})

// Create skills
const skillA = skillSystem.createFromBase(world, baseSkillA, petA.id)
petA.skillIds.push(skillA.id)
const skillB = skillSystem.createFromBase(world, baseSkillB, petB.id)
petB.skillIds.push(skillB.id)

// Create players
const playerA = playerSystem.create(world, 'PlayerA', [petA.id])
const playerB = playerSystem.create(world, 'PlayerB', [petB.id])

// Init state
const battleState = createBattleState(playerA.id, playerB.id)
world.state = battleState as unknown as Record<string, unknown>

console.log('Systems:', Object.keys(world.systems as any))
console.log('State:', world.state)

// --- Run battle ---
const system = new LocalBattleSystemV2(battle)

system.BattleEvent((msg) => {
  console.log(`[${msg.type}]`, JSON.stringify(msg.data ?? '').slice(0, 120))
})

console.log('\nStarting battle...')
await system.ready()
await new Promise(r => setTimeout(r, 200))

const state = await system.getState()
console.log('Status:', state.status)
console.log('Players:', state.players.map(p => `${p.name} (${p.teamAlives} alive)`))

if (state.status !== BattleStatus.OnBattle) {
  console.error('Battle did not start properly!')
  process.exit(1)
}

// Run turns until battle ends
let turn = 0
while (turn++ < 30) {
  const cur = await system.getState()
  if (cur.status === BattleStatus.Ended) break

  await new Promise(r => setTimeout(r, 50))

  const selA = await system.getAvailableSelection(playerA.id as unknown as playerId)
  const selB = await system.getAvailableSelection(playerB.id as unknown as playerId)

  const skillSelA = selA.find(s => s.type === 'use-skill')
  const skillSelB = selB.find(s => s.type === 'use-skill')

  if (skillSelA) await system.submitAction(skillSelA)
  if (skillSelB) await system.submitAction(skillSelB)

  await new Promise(r => setTimeout(r, 200))

  const afterTurn = await system.getState()
  const hpA = afterTurn.players[0]?.activePet?.currentHp
  const hpB = afterTurn.players[1]?.activePet?.currentHp
  console.log(`Turn ${turn}: ${afterTurn.players[0]?.name} HP=${hpA} | ${afterTurn.players[1]?.name} HP=${hpB}`)
}

const final = await system.getState()
console.log('\nBattle ended! Status:', final.status)
console.log('Victor:', (world.state as any).victor)
console.log('End reason:', (world.state as any).endReason)

await system.cleanup()
console.log('Done!')
