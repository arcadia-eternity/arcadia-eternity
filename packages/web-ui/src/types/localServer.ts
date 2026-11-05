import type { LocalBattleHostStatus } from './desktop'

export interface LocalServerConfiguration {
  name: string
  scope: 'local' | 'lan' | 'public'
  port: number
  publicOrigin?: string
  content: 'official' | 'current' | 'saved'
}
export type LocalServerRequest =
  | { action: 'status' | 'restart' | 'recover' }
  | { action: 'start'; configuration?: LocalServerConfiguration }
  | { action: 'start-project'; projectId: string }
  | { action: 'stop'; force?: boolean }
export interface LocalServerSnapshot {
  host: LocalBattleHostStatus
  phase: 'idle' | 'preparing' | 'starting' | 'ready' | 'draining' | 'failed'
  configured: boolean
  error?: { code: string; message: string }
}
