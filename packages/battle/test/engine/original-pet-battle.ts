import {
  BattleStartPhase,
  DamageContext,
  executeTurnOperation,
  type Pet,
  SkillPhase,
  TurnContext,
  UseSkillContext,
  type Battle,
  type Player,
} from '@arcadia-eternity/battle/engine'
import { createOfficialContent } from '@arcadia-eternity/data-pack-base/effects'
import { DamageType, type StatOutBattle } from '@arcadia-eternity/const'
import { afterEach, expect } from 'vitest'
import { loadBasePrototypeData } from './base-metadata'

const catalog = createOfficialContent(loadBasePrototypeData(), 'original-pet-tests')
const battles: Battle[] = []
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})

export function waitTurn(battle: Battle) {
  for (const player of [battle.playerA, battle.playerB]) player.selection = { player: player.id, type: 'do-nothing' }
  executeTurnOperation(new TurnContext(battle), battle)
}

export function strike(battle: Battle, attacker: Pet, target: Pet, amount: number, type = DamageType.Physical) {
  const skill = attacker.skills[0]!
  const cast = new UseSkillContext(new TurnContext(battle), attacker.owner!, attacker, skill.target, skill)
  const damage = new DamageContext(cast, skill, target, amount, type)
  target.damage(damage)
  return damage.result!
}

export function petBattle(
  species: string,
  skills: string[],
  emblem?: string,
  training?: { ivs: StatOutBattle; ivMax?: StatOutBattle; individualValueMax: number },
  reserves: { species: string; skills: string[] }[] = [],
  opponentTeam = [{ species: 'pet_dilan', skills: ['skill_paida'] }],
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
      { name: 'B', team: opponentTeam.map(pet => ({ ...defaults, ...pet, name: pet.species })) },
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
  expect(battle.phaseManager.run(start).success).toBe(true)

  function use(id: string, actor: Player = owner, willHit: boolean | null = true) {
    const skill = actor.activePet.skills.find(candidate => candidate.baseId === id)
    if (!skill) throw new Error(`Missing equipped skill ${id}`)
    actor.currentRage = actor.maxRage
    const turn = new TurnContext(battle)
    const context = new UseSkillContext(turn, actor, actor.activePet, skill.target, skill)
    if (willHit !== null) context.hitOverrides.push({ willHit, priority: 1000 })
    const phase = new SkillPhase(context)
    expect(battle.phaseManager.run(phase).success).toBe(true)
    return context
  }

  return { owner, opponent, battle, use }
}
