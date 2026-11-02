import { computed, type Ref } from 'vue'
import { nanoid } from 'nanoid'
import { Nature } from '@arcadia-eternity/const'
import type { PlayerSchemaType, SpeciesSchemaType, PetSchemaType } from '@arcadia-eternity/schema'
import type { TeamEditorDelegate } from '@/components/team/delegate'

/** A test team belongs to its captured candidate, with no personal collection capabilities. */
export function createPreviewTeamDelegate(
  players: Ref<PlayerSchemaType[]>,
  side: number,
  defaults: PlayerSchemaType[],
  persist: () => void,
): TeamEditorDelegate {
  return {
    team: computed({
      get: () => players.value[side]!.team,
      set: team => {
        players.value[side]!.team = team
        persist()
      },
    }),
    name: computed(() => (side === 0 ? '我方测试队伍' : '对方测试队伍')),
    ready: computed(() => !!players.value[side]),
    persist,
    createPet: () => {
      const template = players.value[side]?.team[0] ?? defaults[side]?.team[0]
      return template ? { ...JSON.parse(JSON.stringify(template)), id: nanoid() } : undefined
    },
    removePet(id, done) {
      players.value[side]!.team = players.value[side]!.team.filter(pet => pet.id !== id)
      persist()
      done()
    },
    removeLabel: '移出测试队伍',
  }
}

/** An empty library can still start authoring from the prepared catalog. */
export function createPreviewPet(species: SpeciesSchemaType | undefined): PetSchemaType | undefined {
  if (!species) return undefined
  return {
    id: nanoid(),
    name: '测试精灵',
    species: species.id,
    level: 100,
    nature: Nature.Hardy,
    skills: species.learnable_skills.slice(0, 4).map(skill => skill.skill_id),
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    ...(species.ability[0] ? { ability: species.ability[0] } : {}),
    ...(species.emblem[0] ? { emblem: species.emblem[0] } : {}),
  }
}
