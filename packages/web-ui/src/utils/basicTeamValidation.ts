import { PetSchema, parseWithErrors, type PetSchemaType } from '@arcadia-eternity/schema'
import { Type } from '@sinclair/typebox'
import { findMissingTeamContent, type TeamContentLookup } from './teamContent'
export type { TeamContentLookup } from './teamContent'

const TeamSchema = Type.Array(PetSchema, { minItems: 1, maxItems: 6 })

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
  }
  if (content) errors.push(...findMissingTeamContent(pets, content).map(item => item.message))
  return errors
}
