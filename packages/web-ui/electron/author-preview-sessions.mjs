import { session } from 'electron'
import { registerClientProtocol } from './client-protocol.mjs'

/** Reopening a candidate retains its scratch teams, without sharing the personal profile. */
export function createAuthorPreviewSessions({ directory, development }) {
  const sessions = new Map()
  return key => {
    if (sessions.has(key)) return sessions.get(key)
    const isolated = session.fromPartition(`author-preview-${key}`, { cache: false })
    if (!development) registerClientProtocol(isolated, directory)
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    isolated.setPermissionCheckHandler(() => false)
    sessions.set(key, isolated)
    return isolated
  }
}
