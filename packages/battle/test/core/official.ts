// Test-only adaptation of the #201 roster. This does not migrate the official effect catalog.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import {
  createBattle,
  StackStrategy,
  AttackTargetOpinion,
  IgnoreStageStrategy,
  type BattleContent,
  type BaseSkill,
  type BaseMark,
  type Species,
  type Battle,
  type BattleOptions,
  type PetBuild,
} from '@arcadia-eternity/battle/core'
import { registry, ref } from './trusted201.js'
export { registry } from './trusted201.js'
import input from '../../src/v2/__tests__/fixtures/baseline/official-switch.input.json'

async function yaml(name: string): Promise<Record<string, unknown>[]> {
  return parse(
    await readFile(fileURLToPath(new URL(`../../../../packs/base/data/${name}.yaml`, import.meta.url)), 'utf8'),
  ) as Record<string, unknown>[]
}
export async function officialContent(): Promise<BattleContent> {
  const [species, skills, marks] = await Promise.all([yaml('species'), yaml('skill'), yaml('mark')])
  return {
    species: species
      .filter(s => ['pet_huanli', 'pet_dilan'].includes(s.id as string))
      .map(s => ({
        ...s,
        abilityIds: s.ability ?? [],
        emblemIds: s.emblem ?? [],
        learnableSkills: s.learnable_skills ?? [],
      })) as unknown as Species[],
    skills: skills
      .filter(s => ['skill_paida', 'skill_qili', 'skill_hunzhuoshuiyu', 'skill_shuipao'].includes(s.id as string))
      .map(s => ({
        ...s,
        priority: 0,
        multihit: 1,
        sureCrit: false,
        ignoreOpponentStageStrategy: IgnoreStageStrategy.none,
        effects: (s.effect as string[]).map(ref),
      })) as unknown as BaseSkill[],
    marks: marks
      .filter(s => s.id === 'mark_hunzhuoshuiyu')
      .map(s => ({
        ...s,
        config: {
          duration: 3,
          persistent: true,
          maxStacks: 1,
          stackable: false,
          stackStrategy: StackStrategy.extend,
          destroyable: true,
          isShield: false,
          keepOnSwitchOut: false,
          transferOnSwitch: false,
          inheritOnFaint: false,
          ...(s.config as object),
        },
        tags: [],
        effects: (s.effect as string[]).map(ref),
      })) as unknown as BaseMark[],
  }
}
export function officialOptions(): BattleOptions {
  return {
    id: 'baseline-201',
    seed: input.seed,
    allowFaintSwitch: true,
    players: input.teams.map(t => ({
      id: t.name,
      name: t.name,
      team: t.team.map(p => ({ ...p, id: `${t.name}/${p.name}` })),
    })) as unknown as BattleOptions['players'],
  }
}
export function officialAction(battle: Battle, side: 'A' | 'B', index: number) {
  const plan = input.actions[side][index]
  if (!plan) throw new Error('Script exhausted')
  if (plan.phase !== battle.phase.kind) throw new Error(`Wrong script phase ${side}: ${index}`)
  const action = battle.getAvailableActions(side).find(action => {
    if (action.type !== plan.type) return false
    if (action.type === 'use-skill')
      return battle.getSkillByID(action.skill).base.id === ('skill' in plan ? plan.skill : null)
    if (action.type === 'switch-pet') return battle.getPetByID(action.pet).name === ('pet' in plan ? plan.pet : null)
    return true
  })
  if (!action) throw new Error('Script action unavailable')
  return action
}
export function runOfficial(content: BattleContent) {
  const battle = createBattle(officialOptions(), content, registry)
  const indexes = { A: 0, B: 0 }
  battle.start()
  while (battle.status !== 'ended') {
    const side = (['A', 'B'] as const).find(s => battle.getAvailableActions(s).length)
    if (!side) throw new Error('Battle stuck')
    if (!battle.submitAction(officialAction(battle, side, indexes[side]++)).accepted) throw new Error('Action rejected')
  }
  if (indexes.A !== 8 || indexes.B !== 8) throw new Error('Unused official actions')
  return battle
}
export function semanticState(battle: Battle) {
  return {
    turn: battle.turn,
    status: battle.status,
    victor: battle.victor,
    endReason: battle.endReason,
    players: battle.players.map(p => ({
      player: p.id,
      rage: p.currentRage,
      active: p.activePet.id,
      pets: p.team.map(pet => ({
        pet: pet.id,
        hp: pet.currentHp,
        alive: pet.isAlive,
        stages: pet.stages,
        marks: pet.marks.map(m => ({ base: m.base.id, stack: m.stack, duration: m.duration, active: m.isActive })),
      })),
    })),
  }
}
export function basicOptions(): BattleOptions {
  const options = officialOptions()
  options.players.forEach(p => {
    p.team.forEach(pet => {
      pet.skills = ['skill_paida']
      pet.maxHp = 100
    })
  })
  return options
}
export function skillAction(battle: Battle, player: string) {
  return {
    player,
    type: 'use-skill' as const,
    skill: battle.getPlayerByID(player).activePet.skills[0].id,
    target: AttackTargetOpinion.opponent,
  }
}
export type { PetBuild }
