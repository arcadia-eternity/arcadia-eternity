import { session } from 'electron'
import { registerClientProtocol } from './client-protocol.mjs'

/** Candidate Sessions isolate renderer state. Project teams and drafts are owned by the project bridge. */
export function createAuthorPreviewSessions({ directory, development }) {
  const sessions = new Map()
  const get = key => {
    if (sessions.has(key)) return sessions.get(key)
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
