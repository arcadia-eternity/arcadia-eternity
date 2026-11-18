import { Value } from '@sinclair/typebox/value'
import { type PetSchemaType, TeamPetPresetSchema, type TeamPetPreset } from '@arcadia-eternity/schema'

const optionalFields = ['inheritedSkill', 'ability', 'emblem', 'enhancement'] as const

export function readPetPreset(input: unknown): TeamPetPreset {
  if (!Value.Check(TeamPetPresetSchema, input)) throw new Error('单宠预设格式无效')
  return input
}

export function capturePetPreset(pet: PetSchemaType): TeamPetPreset {
  const fields: TeamPetPreset['fields'] = {
    nature: pet.nature,
    skills: [...pet.skills],
    ivs: { ...pet.ivs },
    evs: { ...pet.evs },
  }
  for (const key of optionalFields) fields[key] = pet[key] || null
  return { format: 'arcadia.pet-preset', version: 1, name: pet.name.slice(0, 256), species: pet.species, fields }
}

export function previewPetPreset(pet: PetSchemaType, preset: TeamPetPreset): PetSchemaType {
  if (pet.species !== preset.species) throw new Error('预设适用物种：' + preset.species)
  const fields = preset.fields
  const result = Value.Clone(pet)
  if (fields.ivs) Object.assign(result.ivs, fields.ivs)
  if (fields.evs) Object.assign(result.evs, fields.evs)
  if (fields.nature !== undefined) result.nature = fields.nature
  if (fields.skills !== undefined) result.skills = [...fields.skills]
  for (const key of optionalFields) {
    if (fields[key] === null) delete result[key]
    else if (fields[key] !== undefined) result[key] = fields[key]
  }
  return result
}
