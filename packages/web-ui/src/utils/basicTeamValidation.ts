import { PetSchema, parseWithErrors, type PetSchemaType } from '@arcadia-eternity/schema'
import { Type } from '@sinclair/typebox'

const TeamSchema = Type.Array(PetSchema, { minItems: 1, maxItems: 6 })

export interface TeamContentLookup {
  getSpecies: (id: string) => unknown
  getSkill: (id: string) => unknown
  getMark: (id: string) => unknown
}

/** Validate the playable data independently of the retired competitive rules registry. */
export function validateBasicTeam(team: unknown, content?: TeamContentLookup): string[] {
  let pets: PetSchemaType[]
  try {
    pets = parseWithErrors(TeamSchema, team)
  } catch {
    return ['队伍需要包含 1–6 只精灵，且精灵数据必须完整有效。']
  }

  const errors: string[] = []
  const petIds = new Set<string>()
  for (const pet of pets) {
    if (petIds.has(pet.id)) errors.push(`${pet.name} 的精灵编号重复，请重新添加该精灵。`)
    petIds.add(pet.id)
    if (!content) continue
    if (!content.getSpecies(pet.species)) errors.push(`${pet.name} 的种族数据不存在。`)
    if (pet.skills.some(id => !content.getSkill(id))) errors.push(`${pet.name} 包含不存在的技能。`)
    if (pet.ability && !content.getMark(pet.ability)) errors.push(`${pet.name} 的特性数据不存在。`)
    if (pet.emblem && !content.getMark(pet.emblem)) errors.push(`${pet.name} 的纹章数据不存在。`)
  }
  return errors
}
