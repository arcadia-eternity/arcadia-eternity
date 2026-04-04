export type ArcadiaHostRuntime = 'node' | 'web'

export interface ArcadiaEditorCapabilities {
  runtime: ArcadiaHostRuntime
  supportsNodeFs: boolean
  supportsBrowserFsAccess: boolean
  supportsWorkers: boolean
}

export interface QuickOpenItem {
  label: string
  description: string
  detail: string
  uriString: string
}
