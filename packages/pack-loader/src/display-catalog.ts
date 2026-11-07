import type { ContentPrototypeData } from '@arcadia-eternity/battle/v4'
import {
  MarkSchema,
  SkillSchema,
  SpeciesSchema,
  parseWithErrors,
  type ContentPresentation,
  type PresentationManifest,
  type ResourceReference,
} from '@arcadia-eternity/schema'
import { presentationIndex } from './presentation'

type DisplayPackage = { namespace: string; manifest: PresentationManifest }

export function mapPresentationResources(
  presentation: ContentPresentation,
  resolve: (reference: ResourceReference) => ResourceReference,
): ContentPresentation {
  const result = { ...presentation }
  for (const key of ['icon', 'portrait', 'cry', 'sfx', 'background', 'music'] as const) {
    const reference = presentation[key]
    if (reference !== undefined) result[key] = resolve(reference)
  }
  const battle = presentation.battle
  if (battle)
    result.battle = {
      renderer: battle.renderer,
      source: resolve(battle.source),
      ...(battle.fallback !== undefined && { fallback: resolve(battle.fallback) }),
    }
  return result
}

/** Project prepared rules to the fields a display client can consume. */
export function buildDisplayCatalog(
  data: ContentPrototypeData,
  manifests: readonly PresentationManifest[] = [],
  packages: readonly DisplayPackage[] = [],
  { includeRuleDetails = false } = {},
) {
  const text = (raw: unknown) => {
    const record = raw as Record<string, unknown>
    return {
      ...(typeof record.name === 'string' && { name: record.name }),
      ...(typeof record.description === 'string' && { description: record.description }),
    }
  }
  const result = {
    species: data.species.map(raw => ({ ...parseWithErrors(SpeciesSchema, raw), ...text(raw) })),
    skills: data.skills.map(raw => {
      const { effect: _effect, ...display } = parseWithErrors(SkillSchema, raw)
      return { ...display, ...(includeRuleDetails && _effect && { effect: _effect }), ...text(raw) }
    }),
    marks: data.marks.map(raw => {
      const { id, tags, presentation, config, effect } = parseWithErrors(MarkSchema, raw)
      return {
        id,
        tags: tags ?? [],
        ...(presentation && { presentation }),
        ...(includeRuleDetails && config && { config }),
        ...(includeRuleDetails && effect && { effect }),
        ...text(raw),
      }
    }),
  }
  const bindings = presentationIndex(manifests)
  for (const { namespace, manifest } of packages)
    for (const { id: _id, target, ...presentation } of manifest.bindings) {
      const id = namespace ? `${namespace}:${target.id}` : target.id
      bindings.set(`${target.kind}:${id}`, presentation)
    }
  for (const kind of ['species', 'skills', 'marks'] as const) {
    for (const row of result[kind]) {
      const presentation = bindings.get(`${kind}:${row.id}`)
      if (presentation) {
        row.presentation = structuredClone(presentation)
        bindings.delete(`${kind}:${row.id}`)
      }
    }
  }
  // Node source manifests may contain bindings for records excluded from the
  // current runtime. Prepared npm bindings must always point into its catalog.
  for (const { namespace, manifest } of packages)
    for (const { target } of manifest.bindings) {
      const id = namespace ? `${namespace}:${target.id}` : target.id
      if (bindings.has(`${target.kind}:${id}`)) throw new Error(`PRESENTATION_TARGET: ${id}`)
    }
  return result
}

/** Assemble content text for the exact display records in this environment. */
export function buildDisplayLocales(
  packages: readonly DisplayPackage[],
  official: Record<string, Record<string, unknown>>,
  content: Record<'species' | 'skills' | 'marks', readonly { id: string }[]>,
) {
  const bundles: Record<string, Record<string, Record<string, unknown>>> = {}
  const allowed = new Set(['species', 'skill', 'mark', 'mark_ability', 'mark_emblem', 'mark_global'])
  const ids = {
    species: new Set(content.species.map(row => row.id)),
    skill: new Set(content.skills.map(row => row.id)),
    mark: new Set(content.marks.map(row => row.id)),
  }
  const add = (language: string, namespace: string, entries: unknown, prefix = '') => {
    if (!allowed.has(namespace)) throw new Error('LOCALE_NAMESPACE_FORBIDDEN')
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error('LOCALE_INVALID')
    const known = ids[namespace === 'species' ? 'species' : namespace === 'skill' ? 'skill' : 'mark']
    const target = ((bundles[language] ??= {})[namespace] ??= {})
    for (const [key, raw] of Object.entries(entries)) {
      const id = `${prefix}${key}`
      // Official bundles also contain records excluded from this runtime. Never export unrelated UI/local data.
      if (!known.has(id)) {
        if (prefix) throw new Error('LOCALE_CONTENT_NOT_FOUND')
        continue
      }
      if (Object.hasOwn(target, id)) throw new Error('LOCALE_CONFLICT')
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('LOCALE_INVALID')
      const fields: Record<string, string> = {}
      for (const [field, value] of Object.entries(raw)) {
        if (!['name', 'description'].includes(field)) {
          if (prefix) throw new Error('LOCALE_FIELD_FORBIDDEN')
          continue
        }
        if (typeof value !== 'string' || value.length > 16_384) throw new Error('LOCALE_INVALID')
        fields[field] = value
      }
      target[id] = fields
    }
  }
  for (const [language, namespaces] of Object.entries(official ?? {}))
    for (const [namespace, entries] of Object.entries(namespaces))
      if (allowed.has(namespace)) add(language, namespace, entries)
  for (const pkg of packages)
    for (const [language, namespaces] of Object.entries(pkg.manifest.locales))
      for (const [namespace, entries] of Object.entries(namespaces))
        add(language, namespace, entries, pkg.namespace ? `${pkg.namespace}:` : '')
  return { defaultLocale: packages[0]?.manifest.defaultLocale ?? 'zh-CN', bundles }
}
