import i18next from 'i18next'
import { contentLanguage } from '@/i18n/serverContent'
import type { EditorPackage } from './environmentRuleCatalog'
import type { ManagedEnvironmentInstallation, ManagedReadyEnvironmentInstallation } from '@arcadia-eternity/protocol'

type Catalog = NonNullable<ManagedReadyEnvironmentInstallation['contentCatalog']>
export type ReferenceOption = { value: string; label: string }
export type ReferenceOptions = Record<keyof Catalog, ReferenceOption[]>

export function matchingReferences(options: ReferenceOption[], query: string) {
  const search = query.trim().toLowerCase()
  return options.filter(option => option.label.toLowerCase().includes(search)).slice(0, 40)
}
const namespaces = {
  species: ['species'],
  skills: ['skill'],
  marks: ['mark', 'mark_ability', 'mark_emblem', 'mark_global'],
  stages: ['enhancement'],
}

export function environmentReferences(
  selected: { name: string; version: string }[],
  materials: EditorPackage[],
  installations: ManagedEnvironmentInstallation[],
  matching?: ManagedReadyEnvironmentInstallation,
): ReferenceOptions {
  const versions = new Map(selected.map(pkg => [pkg.name, pkg.version]))
  type Member = NonNullable<ManagedReadyEnvironmentInstallation['members']>[number]
  function namespacesFor(members: Member[]) {
    return new Set(
      members.filter(member => versions.get(member.name) === member.version).map(member => member.namespace),
    )
  }
  const namespaceOf = (id: string) => (id.includes(':') ? id.split(':', 1)[0]! : 'base')
  const exact = matching?.contentCatalog
  const catalogs = (exact ? [] : installations).flatMap(item =>
    item.status === 'ready' && item.contentCatalog && item.members
      ? [{ catalog: item.contentCatalog, namespaces: namespacesFor(item.members) }]
      : [],
  )
  function options(kind: keyof Catalog) {
    const entries = new Map<string, string | undefined>()
    if (!exact && kind !== 'stages') {
      for (const pkg of materials) {
        const members = pkg.ruleCatalog?.members
        const scope = members?.length ? namespacesFor(members) : undefined
        if (!scope && versions.get(pkg.name) !== pkg.version) continue
        for (const id of pkg.contentIds?.[kind] ?? [])
          if (!scope || scope.has(namespaceOf(id))) entries.set(id, undefined)
      }
    }
    for (const { catalog, namespaces } of catalogs)
      for (const { id, name } of catalog[kind])
        if (namespaces.has(namespaceOf(id)) && !entries.get(id)) entries.set(id, name)
    for (const { id, name } of exact?.[kind] ?? []) entries.set(id, name ?? entries.get(id))
    return Array.from(entries, ([id, name]) => {
      if (!name && !id.includes(':') && i18next.isInitialized) {
        for (const ns of namespaces[kind]) {
          const localized = i18next.getResource(contentLanguage.value, ns, id + '.name')
          if (typeof localized === 'string') {
            name = localized
            break
          }
        }
      }
      return { value: id, label: name && name !== id ? name + ' · ' + id : id }
    })
  }
  return { species: options('species'), skills: options('skills'), marks: options('marks'), stages: options('stages') }
}
