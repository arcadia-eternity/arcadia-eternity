import { createContentCatalog, type ContentPrototypeData, type ContentCatalog } from '@arcadia-eternity/battle/v4'
import { createOfficialEffectCandidates } from './effects/candidate-catalog'
import { withOfficialTemplates, createOfficialTemplateRegistrations } from './templates'

export type OfficialPrototypeData = ContentPrototypeData
export type OfficialContent = ContentCatalog

/** Assemble the base pack's trusted effects with editable prototype data. */
export function createOfficialContent(data: OfficialPrototypeData, revision: string): OfficialContent {
  return createContentCatalog(
    withOfficialTemplates(data),
    revision,
    createOfficialEffectCandidates,
    createOfficialTemplateRegistrations,
  )
}
