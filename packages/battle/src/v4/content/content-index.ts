import type { ContentPrototypeData } from './definition-catalog'
import { freezeContent } from './immutable'
import {
  normalizeBehaviorDefinitions,
  normalizeBehaviorUses,
  validateBehaviorMetadata,
  validateBehaviorContract,
} from './behaviors'
import { MarkSchema } from './schema/mark'
import { SkillSchema } from './schema/skill'
import { SpeciesSchema } from './schema/species'

/** Read-only data and reference validation. This index cannot create players, effects or battles. */
export function createContentIndex(
  data: ContentPrototypeData,
  revision: string,
  options: { readonly effectIds?: readonly string[]; readonly templates?: readonly unknown[] } = {},
) {
  const templates = normalizeBehaviorDefinitions(options.templates ?? [])
  const definitions = normalizeBehaviorDefinitions([...templates, ...(data.behaviors ?? [])])
  const contracts = new Map(templates.map(definition => [definition.implementation.exportId, definition]))
  const index = <T extends { id: string }>(values: readonly unknown[], kind: string, parse: (raw: unknown) => T) => {
    if (!Array.isArray(values)) throw new Error(`Content ${kind} must be an array`)
    const result = new Map<string, T>()
    for (const raw of values) {
      const value = freezeContent(parse(structuredClone(raw)))
      if (result.has(value.id)) throw new Error(`Duplicate content ${kind}: ${value.id}`)
      result.set(value.id, value)
    }
    return result
  }
  const marks = index(data.marks, 'mark', raw => MarkSchema.parse(raw))
  const skills = index(data.skills, 'skill', raw => SkillSchema.parse(raw))
  const species = index(data.species, 'species', raw => SpeciesSchema.parse(raw))
  const required = <T>(items: ReadonlyMap<string, T>, kind: string, id: string): T => {
    const value = items.get(id)
    if (!value) throw new Error(`Unknown content ${kind}: ${id}`)
    return value
  }
  const references = { marks: new Set(marks.keys()), skills: new Set(skills.keys()) }
  const effectIds = new Set(options.effectIds)
  const behaviorIds: string[] = []
  for (const [kind, entries] of [
    ['petMark', marks],
    ['skill', skills],
  ] as const)
    for (const entry of entries.values()) {
      const owner = { kind, id: entry.id }
      const uses = normalizeBehaviorUses(entry.behaviors ?? [], owner)
      for (const use of uses) {
        const prepared = validateBehaviorMetadata(definitions, use, { owner, references })
        const contract = contracts.get(prepared.definition.implementation.exportId)
        if (contract) validateBehaviorContract(prepared.definition, contract, owner, use.useId)
        behaviorIds.push(prepared.effectId)
      }
      for (const id of entry.effect ?? []) {
        if (id.startsWith('ae:behavior:') || !effectIds.has(id))
          throw new Error(`Unknown or directly referenced behavior effect: ${id} on ${entry.id}`)
      }
    }
  for (const entry of species.values()) {
    for (const skill of entry.learnable_skills) required(skills, 'skill', skill.skill_id)
    for (const mark of [...entry.ability, ...entry.emblem]) required(marks, 'mark', mark)
  }
  return Object.freeze({
    revision,
    effectIds: Object.freeze([...new Set([...effectIds, ...behaviorIds])]),
    marks: Object.freeze([...marks.values()]),
    skills: Object.freeze([...skills.values()]),
    species: Object.freeze([...species.values()]),
    getMark: (id: string) => required(marks, 'mark', id),
    getSkill: (id: string) => required(skills, 'skill', id),
    getSpecies: (id: string) => required(species, 'species', id),
  })
}
export type ContentIndex = ReturnType<typeof createContentIndex>
