import {
  PackMetadataLoader,
  workRef,
  type Json,
  type WorkDraft,
  type WorkRecord,
  type WorkKind,
  type WorkRelease,
  collection,
} from '@arcadia-eternity/pack-loader/native'
import {
  createContentIndex,
  type BehaviorDefinition,
  type ContentPrototypeData,
  type EnvironmentBuildIdentity,
} from '@arcadia-eternity/battle/v4'
import { resolveBasePackRef } from '@/utils/packRef'

export type EffectTemplate =
  (typeof import('@arcadia-eternity/data-pack-base/metadata').officialEffectTemplates)[number]
export interface CreatorContent {
  data: ContentPrototypeData
  build: EnvironmentBuildIdentity
  templates: readonly BehaviorDefinition[]
  effectIds: readonly string[]
  effectTemplates: readonly EffectTemplate[]
}

/** Read the selected package's raw rules and authoring definitions together. */
export async function loadCreatorBase(): Promise<CreatorContent> {
  const loader = new PackMetadataLoader()
  const pack = new URL(await resolveBasePackRef(), window.location.href)
  const [loaded, response] = await Promise.all([
    loader.loadMetadata(pack.href, {
      source: 'http',
      enforceLockfile: true,
      includeLocales: false,
    }),
    fetch(new URL('dist/catalog.json', pack), { cache: 'no-store', redirect: 'error', credentials: 'omit' }),
  ])
  if (!response.ok) throw new Error(`创作定义加载失败（${response.status}）`)
  const catalog: Omit<CreatorContent, 'data'> = await response.json()
  if (
    !catalog?.build ||
    !Array.isArray(catalog.templates) ||
    !Array.isArray(catalog.effectIds) ||
    !Array.isArray(catalog.effectTemplates)
  )
    throw new Error('创作定义格式无效')
  return { ...catalog, data: loaded.data }
}
export const workHost = (base: CreatorContent) => ({
  base: base.data,
  build: base.build,
  templates: base.templates,
  createContent: (data: ContentPrototypeData, revision: string) =>
    createContentIndex(data, revision, { templates: base.templates, effectIds: base.effectIds }),
})
export interface ReferenceOption {
  label: string
  value: Json
}
export function referenceOptions(
  kind: WorkKind,
  draft: WorkDraft,
  base: CreatorContent,
  installed: readonly WorkRelease[],
): ReferenceOption[] {
  const builtins = kind === 'behavior' ? base.templates : (base.data[collection[kind]] ?? [])
  const result: ReferenceOption[] = builtins.map(value => ({
    label: (value as { id: string }).id,
    value: (value as { id: string }).id,
  }))
  const works = [
    draft,
    ...installed.filter(work =>
      draft.dependencies.some(
        dep => dep.projectId === work.project.id && dep.version === work.releaseVersion && dep.digest === work.digest,
      ),
    ),
  ]
  for (const work of works)
    for (const record of work.data[collection[kind]])
      result.push({
        label: `${String(record.name ?? record.id)} · ${work.project.namespace}:${record.id}`,
        value: workRef(work.project.id, kind, record.id),
      })
  return result
}
export const releaseLock = (release: WorkRelease) => ({
  projectId: release.project.id,
  version: release.releaseVersion,
  digest: release.digest,
})
export function defaultRecord(kind: 'species' | 'skill' | 'mark', id: string): WorkRecord {
  if (kind === 'skill')
    return {
      id,
      name: '新技能',
      element: 'Normal',
      category: 'Physical',
      power: 40,
      rage: 0,
      accuracy: 100,
      priority: 0,
      behaviors: [],
    }
  if (kind === 'mark')
    return { id, name: '新印记', config: { duration: 3, maxStacks: 1, stackable: false }, behaviors: [] }
  return {
    id,
    name: '新精灵',
    num: 1,
    element: 'Normal',
    baseStats: { hp: 100, atk: 100, def: 100, spa: 100, spd: 100, spe: 100 },
    genderRatio: null,
    heightRange: [1, 2],
    weightRange: [1, 2],
    ability: [],
    emblem: [],
    learnable_skills: [],
  }
}
