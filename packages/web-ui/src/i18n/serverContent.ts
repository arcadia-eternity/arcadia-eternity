import { shallowRef } from 'vue'
import i18next, { type PostProcessorModule } from 'i18next'
import type { ServerEnvironmentContent } from '@arcadia-eternity/protocol'

// A transient overlay: never write server text into the official locale bundles.
const text = shallowRef(new Map<string, string>())
const activeContent = shallowRef<ServerEnvironmentContent | null>(null)
const remoteContent = shallowRef(false)
export const isRemoteContentActive = () => remoteContent.value
const contentNamespaces = new Set(['species', 'skill', 'mark', 'mark_ability', 'mark_emblem', 'mark_global'])
export const contentLanguage = shallowRef(i18next.language || 'zh-CN')
i18next.on('languageChanged', language => {
  contentLanguage.value = language
})

export function serverText(
  namespace: string,
  id: string,
  field: 'name' | 'description',
  language = contentLanguage.value,
): string | undefined {
  if (!contentNamespaces.has(namespace)) return undefined
  const content = activeContent.value
  const locales = content?.locales
  const kind = namespace.startsWith('mark') ? 'mark' : namespace
  const languages = [...new Set([language, language.split('-')[0], locales?.defaultLocale ?? 'zh-CN'])]
  for (const locale of languages) {
    for (const ns of namespace === 'mark' ? ['mark', 'mark_ability', 'mark_emblem', 'mark_global'] : [namespace]) {
      const entry = locales?.bundles[locale]?.[ns]?.[id]
      if (entry && typeof entry === 'object' && typeof Reflect.get(entry, field) === 'string')
        return Reflect.get(entry, field)
    }
  }
  const value = text.value.get(`${kind}/${id}.${field}`)
  if (value !== undefined) return value
  const rows = kind === 'species' ? content?.species : kind === 'skill' ? content?.skills : content?.marks
  if (rows?.some(row => row.id === id)) return field === 'name' ? id : ''
  return undefined
}

export function setServerContentText(content: ServerEnvironmentContent | null, remote = true) {
  activeContent.value = content
  remoteContent.value = content !== null && remote
  const next = new Map<string, string>()
  for (const [kind, rows] of Object.entries(content ?? {})) {
    const namespace = { species: 'species', skills: 'skill', marks: 'mark' }[kind]
    if (!namespace) continue
    for (const row of rows) {
      for (const field of ['name', 'description'] as const) {
        if (typeof row[field] === 'string') next.set(`${namespace}/${row.id}.${field}`, row[field])
      }
    }
  }
  text.value = next
}

export function getServerContentText(): ServerEnvironmentContent | null {
  return activeContent.value
}

/** Original keys retain namespaced content IDs even when i18next parses a colon. */
export const serverContentText: PostProcessorModule = {
  type: 'postProcessor',
  name: 'serverContentText',
  process(value, keys, options, translator) {
    const currentLanguage = contentLanguage.value
    const language =
      (options.lng as string | undefined) ?? (translator as { language?: string }).language ?? currentLanguage
    const namespaces = typeof options.ns === 'string' ? [options.ns] : (options.ns ?? [])
    for (const key of keys) {
      for (const namespace of namespaces) {
        const match = /^(.*)\.(name|description)$/.exec(key)
        const replacement = match
          ? serverText(namespace, match[1], match[2] as 'name' | 'description', language)
          : undefined
        if (replacement !== undefined) return replacement
        if (match && activeContent.value && contentNamespaces.has(namespace)) return match[2] === 'name' ? match[1] : ''
      }
    }
    return value
  },
}
