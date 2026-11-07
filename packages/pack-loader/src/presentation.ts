import type { ContentPresentation, PresentationManifest, ResourceReference } from '@arcadia-eternity/schema'

/** Join display metadata only at a UI boundary; gameplay records remain resource-free. */
export function presentationIndex(manifests: readonly PresentationManifest[] = []) {
  const result = new Map<string, ContentPresentation>()
  for (const manifest of manifests) {
    const resources = new Map(manifest.resources.map(row => [row.id, row.source]))
    const resolve = (ref: ResourceReference): string => {
      if (typeof ref !== 'string') throw new Error('Cross-package resources require an installed npm environment')
      const source = resources.get(ref)
      if (!source) throw new Error(`Missing resource: ${ref}`)
      return source
    }
    for (const binding of manifest.bindings) {
      const { id: _id, target, ...slots } = binding
      const key = `${target.kind}:${target.id}`
      if (result.has(key)) throw new Error(`Duplicate presentation target: ${key}`)
      const presentation: ContentPresentation = {}
      for (const slot of ['icon', 'portrait', 'cry', 'sfx', 'background', 'music'] as const)
        if (slots[slot]) presentation[slot] = resolve(slots[slot])
      if (slots.battle)
        presentation.battle = {
          renderer: slots.battle.renderer,
          source: resolve(slots.battle.source),
          ...(slots.battle.fallback ? { fallback: resolve(slots.battle.fallback) } : {}),
        }
      result.set(key, presentation)
    }
  }
  return result
}
