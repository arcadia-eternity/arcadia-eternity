import { nanoid } from 'nanoid'
import {
  Nature,
  individualValueSpread,
  resolveEnvironmentMechanics,
  type EnvironmentRules,
} from '@arcadia-eternity/const'
import type { SpeciesSchemaType, PetSchemaType } from '@arcadia-eternity/schema'

/** An empty library can still start authoring from the prepared catalog. */
export function createPreviewPet(
  species: SpeciesSchemaType | undefined,
  rules?: EnvironmentRules,
): PetSchemaType | undefined {
  if (!species) return undefined
  const { defaultValue, max } = resolveEnvironmentMechanics(rules).individualValues
  return {
    id: nanoid(),
    name: '测试精灵',
    species: species.id,
    level: 100,
    nature: Nature.Hardy,
    skills: species.learnable_skills.slice(0, 4).map(skill => skill.skill_id),
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: individualValueSpread(defaultValue),
    ivMax: individualValueSpread(max),
    ...(species.ability[0] ? { ability: species.ability[0] } : {}),
    ...(species.emblem[0] ? { emblem: species.emblem[0] } : {}),
  }
}
