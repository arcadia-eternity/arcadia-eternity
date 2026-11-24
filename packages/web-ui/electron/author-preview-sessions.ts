import { session, type Session } from 'electron'
import { registerClientProtocol } from './client-protocol.ts'

/** Candidate Sessions isolate renderer state. Project teams and drafts are owned by the project bridge. */
export function createAuthorPreviewSessions({ directory, development }: { directory: string; development: boolean }) {
  const sessions = new Map<string, Session>()
  const get = (key: string) => {
    const existing = sessions.get(key)
    if (existing) return existing
    const isolated = session.fromPartition(`author-preview-${key}`, { cache: false })
    if (!development) registerClientProtocol(isolated, directory)
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    isolated.setPermissionCheckHandler(() => false)
    sessions.set(key, isolated)
    return isolated
  }
  get.clear = async () => {
    for (const isolated of sessions.values()) {
      await isolated.closeAllConnections()
      await isolated.clearStorageData()
      if (!development) isolated.protocol.unhandle('arcadia-client')
    }
    sessions.clear()
  }
  return get
}
