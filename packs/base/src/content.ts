import {
  createContentCatalog,
  type ContentPrototypeData,
  type ContentCatalog,
  type BehaviorCatalogOptions,
} from '@arcadia-eternity/battle/engine'
import { createCatalog, createEffects } from 'virtual:arcadia-effects'
import * as sdk from '@arcadia-eternity/battle/authoring'

export type OfficialPrototypeData = ContentPrototypeData
export type OfficialContent = ContentCatalog

/** Assemble the base pack's trusted effects with editable prototype data. */
export function createOfficialContent(
  data: OfficialPrototypeData,
  revision: string,
  additional: BehaviorCatalogOptions = {},
): OfficialContent {
  return createContentCatalog(data, revision, createCatalog, context => ({
    nativeExports: [
      ...createEffects({ sdk, marks: context.marks, id: local => local }),
      ...((typeof additional === 'function' ? additional(context) : additional).nativeExports ?? []),
    ],
  }))
}
