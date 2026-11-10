import {
  BehaviorCompilationError,
  normalizeBehaviorDefinitions,
  type ContentPrototypeData,
} from '@arcadia-eternity/battle/engine'
import { loadEffectTemplates } from '@arcadia-eternity/battle/effect-loading'
import { effectSources } from 'virtual:arcadia-effects'
import type { TemplateRegistration } from './contracts'

const registrations = loadEffectTemplates(effectSources) as readonly TemplateRegistration[]

/** Serializable catalog for content editors. Executable factories are registered separately by the host. */
export const officialEffectTemplates = Object.freeze(registrations.map(entry => entry.template))
export const officialTemplateDefinitions = Object.freeze(officialEffectTemplates.map(entry => entry.definition))

/** Ordinary base-pack content can configure installed native templates, but cannot introduce executable rules. */
export function withOfficialTemplates(data: ContentPrototypeData): ContentPrototypeData {
  const definitions = normalizeBehaviorDefinitions(data.behaviors ?? [])
  for (const definition of definitions) {
    if (definition.implementation.kind !== 'native')
      throw new BehaviorCompilationError([
        {
          code: 'CAPABILITY_MISMATCH',
          contentId: definition.id,
          field: 'implementation',
          message: 'Ordinary content can only reference installed native behaviors',
        },
      ])
    if (officialTemplateDefinitions.some(builtin => builtin.id === definition.id))
      throw new BehaviorCompilationError([
        {
          code: 'DUPLICATE_ID',
          contentId: definition.id,
          field: 'id',
          message: 'Official template definitions cannot be replaced by content data',
        },
      ])
  }
  return { ...data, behaviors: [...officialTemplateDefinitions, ...definitions] }
}

export type { EffectTemplate, TemplateField } from './contracts'
