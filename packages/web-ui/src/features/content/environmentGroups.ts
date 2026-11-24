import type { ManagedEnvironment, ManagedEnvironmentInstallation } from '@/types/management'

export function environmentGroupKey(entry: { key: string; environmentVersion?: string }) {
  return entry.environmentVersion ? 'version/' + entry.environmentVersion : 'source/' + entry.key
}

export function groupEnvironments<T extends EnvironmentLocation>(entries: readonly T[]) {
  const groups = new Map<string, [T, ...T[]]>()
  for (const entry of entries) {
    const id = environmentGroupKey(entry)
    const group = groups.get(id)
    if (group) group.push(entry)
    else groups.set(id, [entry])
  }
  return groups
}

export interface EnvironmentLocation {
  id: string
  environmentVersion?: string
  name: string
  key: string
  source: string
  sources?: string[]
  workspaceId?: string
  serverId?: string
  editable?: boolean
  current?: boolean
}

export function resolveEnvironmentEntry<T extends EnvironmentLocation>(
  entries: readonly T[],
  groupKey?: string,
  currentKey?: string,
) {
  const matching = entries.filter(entry => environmentGroupKey(entry) === groupKey)
  const current = matching.find(entry => entry.key === currentKey)
  if (current?.editable) return current
  return (
    matching.find(entry => entry.editable) ??
    (current?.workspaceId ? current : matching.find(entry => entry.workspaceId)) ??
    current ??
    matching[0]
  )
}

export function managedLocation(
  environment: ManagedEnvironment,
  prefix: string,
  source: string,
  installations: ManagedEnvironmentInstallation[],
) {
  const { id, name } = environment.document
  const installation = installations.find(item => item.environmentId === id && item.status === 'ready')
  const environmentVersion =
    installation?.status === 'ready' && installation.draftRevision === environment.revision
      ? installation.environmentVersion
      : undefined
  return { id, name, environmentVersion, source, key: prefix + '/' + id, editable: !environment.builtin, environment }
}
