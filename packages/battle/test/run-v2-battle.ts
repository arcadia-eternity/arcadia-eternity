// Simple v2 battle test - run from packages/battle
import {
  Nature, Element, Category, AttackTargetOpinion,
  IgnoreStageStrategy, BattleStatus, type playerId,
} from '@arcadia-eternity/const'
import { createEntity, setComponent } from '@arcadia-eternity/engine'
import { createBattle } from '../src/v2/game.js'
import { LocalBattleSystemV2 } from '../src/v2/local-battle.js'
import { createBattleState } from '../src/v2/types/battle-state.js'
import type { SpeciesData } from '../src/v2/schemas/species.schema.js'
import type { BaseSkillData } from '../src/v2/schemas/skill.schema.js'

const speciesA: SpeciesData = {
  type: 'species', id: 'species_a', num: 1, element: Element.Fire,
  baseStats: { hp: 100, atk: 120, def: 80, spa: 60, spd: 60, spe: 90 },
  genderRatio: [50, 50], heightRange: [50, 100], weightRange: [20, 40],
  abilityIds: [], emblemIds: [],
}
const speciesB: SpeciesData = {
  type: 'species', id: 'species_b', num: 2, element: Element.Water,
  baseStats: { hp: 100, atk: 80, def: 100, spa: 80, spd: 80, spe: 70 },
  genderRatio: [50, 50], heightRange: [50, 100], weightRange: [20, 40],
  abilityIds: [], emblemIds: [],
}
const baseSkillA: BaseSkillData = {
  type: 'baseSkill', id: 'skill_a', category: Category.Physical,
  element: Element.Fire, power: 80, accuracy: 100, rage: 0, priority: 0,
  target: AttackTargetOpinion.opponent, multihit: 1,
  sureHit: true, sureCrit: false, ignoreShield: false,
  ignoreOpponentStageStrategy: IgnoreStageStrategy.none, tags: [],
  effectIds: ['effect_reduce_def'],  // Add effect
}
const baseSkillB: BaseSkillData = {
  type: 'baseSkill', id: 'skill_b', category: Category.Special,
  element: Element.Water, power: 80, accuracy: 100, rage: 0, priority: 0,
  target: AttackTargetOpinion.opponent, multihit: 1,
  sureHit: true, sureCrit: false, ignoreShield: false,
  ignoreOpponentStageStrategy: IgnoreStageStrategy.none, tags: [], effectIds: [],
}

console.log('Creating battle...')
const battle = createBattle({ seed: '12345' })
const { world, petSystem, skillSystem, playerSystem } = battle

createEntity(world, speciesA.id, ['species'])
setComponent(world, speciesA.id, 'species', speciesA)
createEntity(world, speciesB.id, ['species'])
setComponent(world, speciesB.id, 'species', speciesB)
createEntity(world, baseSkillA.id, ['baseSkill'])
setComponent(world, baseSkillA.id, 'baseSkill', baseSkillA)
createEntity(world, baseSkillB.id, ['baseSkill'])
setComponent(world, baseSkillB.id, 'baseSkill', baseSkillB)

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

const skillA = skillSystem.createFromBase(world, baseSkillA, petA.id)
petA.skillIds.push(skillA.id)

// Attach effect to skillA
const testEffect = {
  id: 'effect_reduce_def',
  triggers: ['OnDamage'],
  priority: 0,
  condition: {
    type: 'every',
    conditions: [
      { type: 'selfUseSkill' },
      {
        type: 'evaluate',
        target: { base: 'self' },
        evaluator: {
          type: 'probability',
          percent: { type: 'raw:number', value: 100 }  // 100% for testing
        }
      }
    ]
  },
  apply: {
    type: 'statStageBuff',
    target: { base: 'opponent' },
    stat: 'def',      // Fixed: use 'stat' not 'statType'
    stage: -1         // Fixed: use 'stage' not 'value'
  }
}

battle.effectPipeline.attachEffect(world, skillA.id, testEffect)
console.log('Attached effect to skillA:', testEffect.id)

// Check if effect was attached using the pipeline's getEffects method
const attachedEffects = battle.effectPipeline.getEffects(world, skillA.id)
console.log('Effects on skillA:', attachedEffects.length, 'effects')

const skillB = skillSystem.createFromBase(world, baseSkillB, petB.id)
petB.skillIds.push(skillB.id)

const playerA = playerSystem.create(world, 'PlayerA', [petA.id])
const playerB = playerSystem.create(world, 'PlayerB', [petB.id])

const battleState = createBattleState(playerA.id, playerB.id)
world.state = battleState as unknown as Record<string, unknown>

console.log('Systems:', Object.keys(world.systems as any))

const system = new LocalBattleSystemV2(battle)
let eventCount = 0
system.BattleEvent((msg) => {
  eventCount++
  console.log(`  [${msg.type}]`, JSON.stringify(msg.data ?? '').slice(0, 150))
})

console.log('\nStarting battle...')
await system.ready()
await new Promise(r => setTimeout(r, 200))

const state = await system.getState()
console.log('Status:', state.status)
console.log('Players:', state.players.map(p => `${p.name} (${p.teamAlives} alive)`))
console.log('Total events received:', eventCount)

if (state.status !== BattleStatus.OnBattle) {
  console.error('Battle did not start!')
  await system.cleanup()
  process.exit(1)
}

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

  const after = await system.getState()
  const pA = after.players[0]
  const pB = after.players[1]
  console.log(`Turn ${turn}: ${pA?.name} HP=${(pA?.activePet as any)?.currentHp} | ${pB?.name} HP=${(pB?.activePet as any)?.currentHp}`)
}

const final = await system.getState()
console.log('\nBattle ended! Status:', final.status)
console.log('Victor:', (world.state as any).victor)
console.log('End reason:', (world.state as any).endReason)
await system.cleanup()
console.log('Done!')
