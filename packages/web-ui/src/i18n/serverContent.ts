import { shallowRef } from 'vue'
import MarkdownIt from 'markdown-it'
import i18next, { type PostProcessorModule } from 'i18next'
import type { ServerEnvironmentContent } from '@arcadia-eternity/protocol'

// A transient overlay: never write server text into the official locale bundles.
const text = shallowRef(new Map<string, string>())
const activeContent = shallowRef<ServerEnvironmentContent | null>(null)
export const contentLanguage = shallowRef(i18next.language || 'zh-CN')
i18next.on('languageChanged', language => {
  contentLanguage.value = language
})

export function serverText(
  namespace: string,
  id: string,
  field: 'name' | 'description',
  language = contentLanguage.value,
): { value: string; rich: boolean } | undefined {
  const content = activeContent.value
  const locales = content?.locales
  const kind = namespace.startsWith('mark') ? 'mark' : namespace
  const languages = [...new Set([language, language.split('-')[0], locales?.defaultLocale ?? 'zh-CN'])]
  for (const locale of languages) {
    for (const ns of namespace === 'mark' ? ['mark', 'mark_ability', 'mark_emblem', 'mark_global'] : [namespace]) {
      const entry = locales?.bundles[locale]?.[ns]?.[id]
      if (entry && typeof entry === 'object' && typeof Reflect.get(entry, field) === 'string')
        return { value: Reflect.get(entry, field), rich: true }
    }
  }
  const value = text.value.get(`${kind}/${id}.${field}`)
  return value === undefined ? undefined : { value, rich: false }
}

export function setServerContentText(content: ServerEnvironmentContent | null) {
  activeContent.value = content
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
        const replacement = match && serverText(namespace, match[1], match[2] as 'name' | 'description', language)
        if (replacement) return replacement.value
      }
    }
    return value
  },
}

const safeMarkdown = new MarkdownIt({ html: false })
/** Keep official formatting, while author text cannot introduce executable HTML. */
export function renderContentDescription(markdown: MarkdownIt, value: string, namespace: string, id: string): string {
  return (text.value.has(`${namespace}/${id}.description`) ? safeMarkdown : markdown).render(value)
}
