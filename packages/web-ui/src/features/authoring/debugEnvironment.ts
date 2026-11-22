import type { EnvironmentDocument } from '@arcadia-eternity/content-sdk/management-workspace'

type DebugDocument =
  EnvironmentDocument | (Omit<EnvironmentDocument, 'schemaVersion' | 'rules' | 'requires'> & { schemaVersion: 1 })
export type DebugEnvironment = DebugDocument & { version: string | null }

export interface DebugEnvironmentBridge {
  (action: 'list'): Promise<DebugEnvironment[]>
  (action: 'save', input: { document: DebugDocument; expectedVersion: string | null }): Promise<DebugEnvironment>
  (action: 'add-source'): Promise<{ name: string; changed: boolean } | null>
  (action: 'prepare', input: { environmentId: string }): Promise<{ preparing: true }>
}
