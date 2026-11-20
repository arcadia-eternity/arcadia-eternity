import type { ManagedEnvironment } from '@/types/management'

export function groupEnvironments<T>(entries: readonly T[], idOf: (entry: T) => string) {
  const groups = new Map<string, [T, ...T[]]>()
  for (const entry of entries) {
    const id = idOf(entry)
    const group = groups.get(id)
    if (group) group.push(entry)
    else groups.set(id, [entry])
  }
  return groups
}

export interface EnvironmentLocation {
  id: string
  name: string
  key: string
  source: string
  workspaceId?: string
  serverId?: string
  editable?: boolean
  current?: boolean
}

export function resolveEnvironmentEntry<T extends EnvironmentLocation>(
  entries: readonly T[],
  id?: string,
  currentKey?: string,
) {
  const matching = entries.filter(entry => entry.id === id)
  const current = matching.find(entry => entry.key === currentKey)
  return current?.editable ? current : (matching.find(entry => entry.editable) ?? matching[0])
}

export function managedLocation(environment: ManagedEnvironment, prefix: string, source: string) {
  const { id, name } = environment.document
  return { id, name, source, key: prefix + '/' + id, editable: !environment.builtin, environment }
}
