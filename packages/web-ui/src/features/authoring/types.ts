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
interface SourceFile {
  file: string
  size?: number
  modified?: number
  error?: string
}
interface SourceAsset extends SourceFile {
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
interface AuthorDiagnostic {
  code: string
  message: string
  file?: string
  line?: number
  column?: number
}
export interface AuthorSnapshot {
  manifestVersion?: string
  dependencies?: Record<string, string>
  arcadiaRange?: string
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
export const jobStates: Record<string, string> = {
  queued: '排队中',
  running: '进行中',
  succeeded: '已完成',
  failed: '未完成',
  cancelled: '已停止',
  interrupted: '已中断',
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
    filename?: string
    integrity?: string
    files?: string[]
    candidate?: { integrity: string; sdkApi: number; build: { coreBuildId: string; registryBuildId: string } }
    preview?: { endpoint: string; clientPath: string; url?: string }
  }
}
export async function authorCall<T>(input: Record<string, unknown>): Promise<T> {
  const invoke = window.arcadiaDesktop?.author
  if (!invoke) throw new Error('请使用新版桌面客户端打开源项目')
  // Vue forms contain reactive proxies; IPC accepts plain structured-cloneable data.
  const response = await invoke(JSON.parse(JSON.stringify(input)))
  if (input.action === 'creator-github' && response.error?.message === '不支持的作者操作')
    throw new Error('请保存修改，退出并重新打开桌面客户端，再使用 GitHub 同步。')
  if (response.error) throw Object.assign(new Error(response.error.message), { code: response.error.code })
  return response.result as T
}
