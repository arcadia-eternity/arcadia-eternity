import { shallowRef } from 'vue'
import MarkdownIt from 'markdown-it'
import type { PostProcessorModule } from 'i18next'
import type { ServerEnvironmentContent } from '@arcadia-eternity/protocol'

// A transient overlay: never write server text into the official locale bundles.
const text = shallowRef(new Map<string, string>())
export function setServerContentText(content: ServerEnvironmentContent | null) {
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

/** Original keys retain namespaced content IDs even when i18next parses a colon. */
export const serverContentText: PostProcessorModule = {
  type: 'postProcessor',
  name: 'serverContentText',
  process(value, keys, options) {
    const namespaces = typeof options.ns === 'string' ? [options.ns] : (options.ns ?? [])
    for (const key of keys) {
      for (const namespace of namespaces) {
        const kind = namespace.startsWith('mark') ? 'mark' : namespace
        const replacement = text.value.get(`${kind}/${key}`)
        if (replacement !== undefined) return replacement
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
