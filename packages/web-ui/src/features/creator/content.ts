import {
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
} from '@arcadia-eternity/battle/engine'
import { getDesktopApi } from '@/utils/env'

export type EffectTemplate =
  (typeof import('@arcadia-eternity/data-pack-base/metadata').officialEffectTemplates)[number]
export interface CreatorContent {
  data: ContentPrototypeData
  build: EnvironmentBuildIdentity
  templates: readonly BehaviorDefinition[]
  effectIds: readonly string[]
  effectTemplates: readonly EffectTemplate[]
}

/** Read the installed base package's rules and authoring definitions together. */
export async function loadCreatorBase(): Promise<CreatorContent> {
  const api = getDesktopApi()
  if (!api?.readCreatorBase) throw new Error('本地创作内容服务不可用')
  return api.readCreatorBase()
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
