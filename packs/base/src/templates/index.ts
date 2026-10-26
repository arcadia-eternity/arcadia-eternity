import {
  BehaviorCompilationError,
  normalizeBehaviorDefinitions,
  type BaseMark,
  type ContentPrototypeData,
} from '@arcadia-eternity/battle/v4'
import { markTemplates } from './marks'
import { combatTemplates } from './combat'
import { resourceTemplates } from './resources'

const registrations = [...markTemplates, ...combatTemplates, ...resourceTemplates]
if (new Set(registrations.map(entry => entry.template.id)).size !== registrations.length)
  throw new Error('Duplicate official effect template')

/** Serializable catalog for content editors. Executable factories are registered separately by the host. */
export const officialEffectTemplates = Object.freeze(registrations.map(entry => entry.template))
export const officialTemplateDefinitions = Object.freeze(officialEffectTemplates.map(entry => entry.definition))
export function createOfficialTemplateRegistrations(content: { readonly marks: ReadonlyMap<string, BaseMark> }) {
  const marks = new Map(content.marks)
  return { nativeExports: Object.freeze(registrations.map(entry => entry.register(marks))) }
}

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
