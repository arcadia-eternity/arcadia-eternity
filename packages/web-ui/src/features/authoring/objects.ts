import type { ContentRow, LocaleSource, SourceRecord } from './types'
import { namespaces } from './catalog'

export const contentTypes: Record<string, string> = {
  species: '精灵',
  skills: '技能',
  marks: '印记',
  ability: '特性',
  emblem: '纹章',
}
export function objectType(row: SourceRecord) {
  const tags = row.record.tags
  return row.kind === 'marks' && Array.isArray(tags)
    ? tags.includes('ability')
      ? 'ability'
      : tags.includes('emblem')
        ? 'emblem'
        : 'marks'
    : row.kind
}
export function localeFor(sources: LocaleSource[], row: SourceRecord, language: string, files: string[]) {
  const known = [
    ...new Set(
      sources
        .filter(
          source => namespaces[row.kind]?.includes(source.namespace) && Object.hasOwn(source.entries, row.record.id),
        )
        .map(source => source.namespace),
    ),
  ]
  if (known.length > 1) return undefined
  const namespace =
    known[0] ??
    (row.kind === 'marks'
      ? (({ ability: 'mark_ability', emblem: 'mark_emblem' } as Record<string, string>)[objectType(row)] ?? 'mark')
      : row.kind === 'skills'
        ? 'skill'
        : row.kind)
  const candidates = sources.filter(source => source.language === language && source.namespace === namespace)
  if (candidates.length) return candidates.length === 1 ? candidates[0] : undefined
  const file = `locales/${language}/${namespace}.yaml`
  if (
    !/^[A-Za-z][A-Za-z0-9-]*$/.test(language) ||
    files.some(path => path.replace(/\.(json|ya?ml)$/, '') === file.slice(0, -5))
  )
    return undefined
  return { file, version: null, language, namespace, entries: {}, sharedFields: [] } satisfies LocaleSource
}
export function initialRecord(type: string, id: string): ContentRow {
  if (type === 'species')
    return {
      id,
      num: 0,
      element: 'Normal',
      baseStats: { hp: 100, atk: 100, def: 100, spa: 100, spd: 100, spe: 100 },
      genderRatio: null,
      heightRange: [1, 2],
      weightRange: [1, 2],
      learnable_skills: [],
      ability: [],
      emblem: [],
    }
  if (type === 'skills')
    return {
      id,
      element: 'Normal',
      category: 'Physical',
      power: 40,
      rage: 0,
      accuracy: 100,
      priority: 0,
      behaviors: [],
    }
  const persistent = ['ability', 'emblem'].includes(type)
  return {
    id,
    tags: persistent ? [type] : ['status'],
    config: {
      duration: persistent ? -1 : 2,
      persistent,
      maxStacks: 1,
      stackable: false,
      stackStrategy: 'refresh',
      keepOnSwitchOut: persistent,
    },
    behaviors: [],
  }
}
