import type { ServerEnvironmentContent } from '@arcadia-eternity/protocol'

const contentKinds = ['species', 'skills', 'marks'] as const
type ContentKind = (typeof contentKinds)[number]
type PreviewCatalog = Record<ContentKind, readonly { id: string; name?: string }[]> &
  Pick<ServerEnvironmentContent, 'locales'>
type PreviewGroup = { count: number; examples: string[] }
export type PackagePreview = Record<ContentKind, PreviewGroup>

const localeNamespaces = {
  species: ['species'],
  skills: ['skill'],
  marks: ['mark', 'mark_ability', 'mark_emblem', 'mark_global'],
}

export function indexPackagePreviews(catalog?: PreviewCatalog) {
  if (!catalog) return
  const byNamespace = new Map<string, PackagePreview>()
  const locales = catalog.locales?.bundles[catalog.locales.defaultLocale]
  for (const kind of contentKinds) {
    for (const { id, name } of catalog[kind]) {
      const separator = id.indexOf(':')
      const namespace = separator < 0 ? '' : id.slice(0, separator)
      let preview = byNamespace.get(namespace)
      if (!preview) {
        preview = emptyPackagePreview()
        byNamespace.set(namespace, preview)
      }
      const group = preview[kind]
      group.count++
      if (group.examples.length === 3) continue
      let displayName = name
      for (const localeNamespace of localeNamespaces[kind]) {
        const entry = locales?.[localeNamespace]?.[id]
        if (entry && typeof entry === 'object' && 'name' in entry && typeof entry.name === 'string') {
          displayName = entry.name
          break
        }
      }
      group.examples.push(displayName || id)
    }
  }
  return byNamespace
}

export function packagePreview(
  previews: ReturnType<typeof indexPackagePreviews>,
  pkg: { name: string; namespace?: string; projectId?: string },
) {
  // Older bundled catalogs label the official base package by name only.
  const namespace =
    pkg.projectId === 'base'
      ? ''
      : (pkg.namespace ?? (pkg.name === '@arcadia-eternity/data-pack-base' ? '' : undefined))
  if (previews && namespace !== undefined) return previews.get(namespace) ?? emptyPackagePreview()
}

function emptyPackagePreview(): PackagePreview {
  return {
    species: { count: 0, examples: [] },
    skills: { count: 0, examples: [] },
    marks: { count: 0, examples: [] },
  }
}
