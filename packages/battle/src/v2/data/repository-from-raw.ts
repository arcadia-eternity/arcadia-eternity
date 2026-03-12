import { V2DataRepository } from './v2-data-repository.js'
import { parseEffect, parseMark, parseSkill, parseSpecies } from './parsers/index.js'

export interface RawDataBundle {
  effects: ReadonlyArray<Record<string, unknown>>
  marks: ReadonlyArray<Record<string, unknown>>
  skills: ReadonlyArray<Record<string, unknown>>
  species: ReadonlyArray<Record<string, unknown>>
}

export function createRepositoryFromRawData(bundle: RawDataBundle): V2DataRepository {
  const repository = new V2DataRepository()

  for (const raw of bundle.effects) {
    const effect = parseEffect(raw)
    repository.registerEffect(effect.id, effect)
  }

  for (const raw of bundle.marks) {
    const mark = parseMark(raw)
    repository.registerMark(mark.id, mark)
  }

  for (const raw of bundle.skills) {
    const skill = parseSkill(raw)
    repository.registerSkill(skill.id, skill)
  }

  for (const raw of bundle.species) {
    const species = parseSpecies(raw)
    repository.registerSpecies(species.id, species)
  }

  return repository
}
