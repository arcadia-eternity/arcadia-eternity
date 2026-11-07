import type { ManagementCapabilities, ManagementScope } from '@arcadia-eternity/protocol'

export type {
  ManagementScope,
  ManagementCapabilities,
  ManagedServer,
  ManagedServerSettings,
  ManagedEnvironmentDocument,
  ManagedEnvironment,
  ManagedEnvironmentVersion,
  ManagedReadyEnvironmentVersion,
  ManagedUnavailableEnvironmentVersion,
  ManagedBinding,
  ManagementOperation,
  ManagementGrant,
  ManagedAccount,
  ManagedPlayer,
  ManagedBattle,
  ManagementAuditEntry,
  ManagedServiceCredential,
} from '@arcadia-eternity/protocol'

export function hasManagementPermission(
  capabilities: ManagementCapabilities | undefined,
  scope: ManagementScope,
  action: string,
): boolean {
  return !!capabilities?.effectivePermissions.some(
    grant =>
      grant.scope.kind === scope.kind &&
      grant.scope.id === scope.id &&
      (grant.actions.includes(action) || grant.actions.includes('*')),
  )
}
