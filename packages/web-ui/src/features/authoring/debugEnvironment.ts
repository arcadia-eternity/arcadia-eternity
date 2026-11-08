export interface DebugEnvironment {
  schemaVersion: 1
  id: string
  name: string
  packages: Record<string, string>
  sources: string[]
  version: string | null
}
