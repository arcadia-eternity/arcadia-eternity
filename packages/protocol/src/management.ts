/** Public management wire contracts shared by HTTP, desktop IPC and UI. No storage or credential implementation types. */
export interface ManagedServiceCredential {
  id: string
  principalId: string
  createdAt: number
  expiresAt: number
  permissions: { scope: ManagementScope; actions: string[] }[]
}
export interface ManagementScope {
  kind: 'workspace' | 'server'
  id: string
}
export interface ManagementCapabilities {
  serverId: string
  workspaceId: string
  supportedFeatures: string[]
  effectivePermissions: { scope: ManagementScope; actions: string[] }[]
  resourceRestrictions: { resourceId?: string; action?: string; reason: string }[]
}
export interface ManagedServer {
  id: string
  revision: number
  name: string
  workspaceId: string
  defaultBindingId?: string
  draining: boolean
  status: string
  settings?: ManagedServerSettings
  runtimeSettings?: ManagedServerSettings
  pendingRestart?: string[]
  requiresRestart?: boolean
  activeBattles?: number
  rooms?: number
  queued?: number
  listenAddress?: { host: string; port: number }
}
export interface ManagedServerSettings {
  host: string
  port: number
  publicOrigin?: string
  corsOrigins: string[]
  battleCapacity: {
    maxConcurrentBattles: number
    maxIdleWorkers: number
    maxQueuedBattles: number
    battleQueueTimeoutMs: number
  }
}
export interface ManagedEnvironmentDocument {
  schemaVersion: 2
  id: string
  name: string
  packages: Record<string, string>
  sources: string[]
  disabled?: { packages: Record<string, string>; sources: string[] }
  rules: {
    schemaVersion: 1
    tier?: string
    allow?: { species?: string[]; skills?: string[]; marks?: string[] }
    deny?: { species?: string[]; skills?: string[]; marks?: string[] }
    team?: { minSize?: number; maxSize?: number; uniqueSpecies?: boolean }
  }
  requires: { engine?: string; sdk?: string; capabilities?: string[] }
}
export interface ManagedEnvironment {
  document: ManagedEnvironmentDocument
  revision: string
}
export interface ManagedReadyEnvironmentVersion {
  versionId: string
  environmentId: string
  workspaceId: string
  document: ManagedEnvironmentDocument
  draftRevision: string
  contentRevision: string
  members?: {
    name: string
    version: string
    projectId: string
    namespace: string
    direct: boolean
    dependencies: string[]
    requiredBy: string[]
  }[]
  packages: unknown[]
  createdAt: number
  status: 'ready'
}
export interface ManagedUnavailableEnvironmentVersion {
  versionId: string
  workspaceId: string
  environmentId?: string
  status: 'unavailable'
  reason: string
}
export type ManagedEnvironmentVersion = ManagedReadyEnvironmentVersion | ManagedUnavailableEnvironmentVersion
export interface ManagedBinding {
  id: string
  revision: number
  serverId: string
  workspaceId: string
  environmentId: string
  selection: 'pinned' | 'follow-ready'
  desiredVersionId?: string
  effectiveVersionId?: string
  enabled: boolean
  visibility: 'public' | 'private'
  matchmakingEnabled: boolean
  executionPolicy?: 'server' | 'peer'
  condition: string
  reason?: string
}
export interface ManagementOperation {
  id: string
  kind: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'
  progress?: number | { stage?: string; message?: string; completed?: number; total?: number }
  error?: { code: string; message: string; retryable?: boolean } | string
  cancelRequested?: boolean
  createdAt?: number
  updatedAt?: number
  revision?: number
  attempt?: number
  committed?: boolean
  result?: unknown
  retryOf?: string
  rootOperationId?: string
}
export interface ManagementGrant {
  id: string
  revision: number
  principalId: string
  scope: ManagementScope
  actions: string[]
}
export interface ManagedAccount {
  accountId: string
  status: 'active' | 'deactivated'
  createdAt: number
  deactivatedAt?: number | null
}

/** Public operational metadata. Never includes session tokens, teams or hidden decisions. */
export interface ManagedPlayer {
  seatId: string
  name: string
  kind: 'guest' | 'account'
  accountId?: string
  connected: boolean
  roomCode?: string
  battleId?: string
}
export interface ManagedBattle {
  id: string
  roomCode: string
  environmentId: string
  environmentName: string
  bindingId?: string
  versionId?: string
  execution: 'server' | 'peer'
  state: 'running' | 'reconnecting'
  startedAt: number
  turn?: number
  players: { seatId: string; name: string; connected: boolean }[]
}
export interface ManagementAuditEntry {
  id: string
  actor: string
  action: string
  target: string
  reason?: string
  createdAt: number
}
