import {
  BattleStartPhase,
  SkillPhase,
  TurnContext,
  UseSkillContext,
  type Battle,
  type Player,
} from '@arcadia-eternity/battle/engine'
import { createOfficialContent } from '@arcadia-eternity/data-pack-base/effects'
import type { StatOutBattle } from '@arcadia-eternity/const'
import { afterEach, expect } from 'vitest'
import { loadBasePrototypeData } from './base-metadata'

const catalog = createOfficialContent(loadBasePrototypeData(), 'original-pet-tests')
const battles: Battle[] = []
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})

export function petBattle(
  species: string,
  skills: string[],
  emblem?: string,
  training?: { ivs: StatOutBattle; ivMax?: StatOutBattle; individualValueMax: number },
  reserves: { species: string; skills: string[] }[] = [],
) {
  const stats = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }
  const defaults = { level: 100, nature: 'Hardy', evs: stats, ivs: stats }
  const [owner, opponent] = catalog.parsePlayers(
    [
      {
        name: 'A',
        team: [
          { ...defaults, name: species, species, skills, emblem, ivs: training?.ivs ?? stats, ivMax: training?.ivMax },
          ...reserves.map(pet => ({ ...defaults, ...pet, name: pet.species })),
        ],
      },
      { name: 'B', team: [{ ...defaults, name: '迪兰', species: 'pet_dilan', skills: ['skill_paida'] }] },
    ],
    { individualValueMax: training?.individualValueMax },
  )
  const battle = catalog.createBattle(owner, opponent, {
    individualValueMax: training?.individualValueMax,
    rngSeed: species,
    timerConfig: { enabled: false },
  })
  battles.push(battle)
  const start = new BattleStartPhase(battle)
  battle.phaseManager.registerPhase(start)
  expect(battle.phaseManager.executePhase(start.id).success).toBe(true)

  function use(id: string, actor: Player = owner, willHit = true) {
    const skill = actor.activePet.skills.find(candidate => candidate.baseId === id)
    if (!skill) throw new Error(`Missing equipped skill ${id}`)
    actor.currentRage = actor.maxRage
    const turn = new TurnContext(battle)
    const context = new UseSkillContext(turn, actor, actor.activePet, skill.target, skill)
    context.hitOverrides.push({ willHit, priority: 1000 })
    const phase = new SkillPhase(battle, actor, actor.activePet, skill.target, skill, turn, context)
    battle.phaseManager.registerPhase(phase)
    expect(battle.phaseManager.executePhase(phase.id).success).toBe(true)
    return context
  }

  return { owner, opponent, battle, use }
}
