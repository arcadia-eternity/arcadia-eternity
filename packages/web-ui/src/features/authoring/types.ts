import type { Json } from '@arcadia-eternity/pack-loader/native'
export type ContentRow = Record<string, Json> & { id: string }
export interface SharedField {
  path: (string | number)[]
  reason: 'anchor' | 'alias' | 'merge'
  anchor: string
  sourcePath: (string | number)[]
  line?: number
  column?: number
}
export interface SourceRecord {
  kind: string
  file: string
  index: number | null
  version: string | null
  record: ContentRow
  sharedFields?: SharedField[]
  line?: number
  column?: number
}
export interface SourceFile {
  file: string
  size?: number
  modified?: number
  error?: string
}
export interface SourceAsset extends SourceFile {
  id: string
  references: { file: string; kind: string; id: string }[]
}
export interface LocaleText {
  name?: string
  description?: string
}
export interface LocaleSource {
  file: string
  version: string | null
  language: string
  namespace: string
  entries: Record<string, LocaleText>
  sharedFields: SharedField[]
  locations?: Record<string, { line: number; column: number }>
}
export interface AuthorDiagnostic {
  code: string
  message: string
  file?: string
  line?: number
  column?: number
}
export interface AuthorSnapshot {
  version?: string
  root: string
  name: string
  project: { projectId: string; namespace: string; sdkApi?: number }
  capabilities?: { sourceEditing: boolean; structuredSaving: boolean; localeEditing: boolean }
  records: SourceRecord[]
  files: SourceFile[]
  assets: SourceAsset[]
  locales: Record<string, Json>
  localeSources: LocaleSource[]
  diagnostics: AuthorDiagnostic[]
}
export interface SourceProject {
  readOnly?: boolean
  published?: boolean
  id: string
  directory: string
  name: string
}
export interface AuthorJob {
  jobId: string
  kind: string
  state: string
  stale: boolean
  sourceRevision: string
  output: string
  diagnostics: AuthorDiagnostic[]
  result?: {
    candidate?: { integrity: string; sdkApi: number; build: { coreBuildId: string; registryBuildId: string } }
  }
}
export async function authorCall<T>(input: Record<string, unknown>): Promise<T> {
  const invoke = window.arcadiaDesktop?.author
  if (!invoke) throw new Error('请使用新版桌面客户端打开源项目')
  // Vue forms contain reactive proxies; IPC accepts plain structured-cloneable data.
  const response = await invoke(JSON.parse(JSON.stringify(input)))
  if (response.error) throw Object.assign(new Error(response.error.message), { code: response.error.code })
  return response.result as T
}
