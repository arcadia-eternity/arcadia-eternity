import {
  createContentCatalog,
  type ContentPrototypeData,
  type ContentCatalog,
  type BehaviorCatalogOptions,
} from '@arcadia-eternity/battle/v4'
import { createOfficialEffectCandidates } from './effects/candidate-catalog'
import { withOfficialTemplates, createOfficialTemplateRegistrations } from './templates'

export type OfficialPrototypeData = ContentPrototypeData
export type OfficialContent = ContentCatalog

/** Assemble the base pack's trusted effects with editable prototype data. */
export function createOfficialContent(
  data: OfficialPrototypeData,
  revision: string,
  additional: BehaviorCatalogOptions = {},
): OfficialContent {
  return createContentCatalog(withOfficialTemplates(data), revision, createOfficialEffectCandidates, context => ({
    nativeExports: [
      ...(createOfficialTemplateRegistrations(context).nativeExports ?? []),
      ...((typeof additional === 'function' ? additional(context) : additional).nativeExports ?? []),
    ],
  }))
}
