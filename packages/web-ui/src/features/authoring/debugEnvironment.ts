export interface DebugEnvironment {
  schemaVersion: 1
  id: string
  name: string
  packages: Record<string, string>
  sources: string[]
  version: string | null
}
export interface DebugEnvironmentBridge {
  (action: 'list'): Promise<DebugEnvironment[]>
  (
    action: 'save',
    input: { document: Omit<DebugEnvironment, 'version'>; expectedVersion: string | null },
  ): Promise<DebugEnvironment>
  (action: 'prepare', input: { environmentId: string }): Promise<{ preparing: boolean }>
  (action: 'add-source'): Promise<{ name: string } | null>
}
