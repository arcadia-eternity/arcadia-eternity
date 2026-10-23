import {
  createContentCatalog,
  type ContentPrototypeData,
  type ContentCatalog,
  type CompiledContentPack,
} from '@arcadia-eternity/battle/v4'
import { createOfficialEffectCandidates } from './effects/candidate-catalog'

export type OfficialPrototypeData = ContentPrototypeData
export type OfficialContent = ContentCatalog

/** Assemble the base pack's trusted effects with editable prototype data. */
export function createOfficialContent(
  data: OfficialPrototypeData,
  revision: string,
  packs: readonly CompiledContentPack[] = [],
): OfficialContent {
  return createContentCatalog(data, revision, createOfficialEffectCandidates, packs)
}
