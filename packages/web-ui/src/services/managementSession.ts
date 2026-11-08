import { ManagementError, type ManagementClient } from './managementClient'

export interface ManagementSessionInfo {
  principalId: string
  csrfToken: string
  expiresAt: number
}
const discoveryKey = (endpoint: string) => `arcadia-management-known:${endpoint}`
// This is only a network-discovery hint, never authorization. The server still verifies every session.
export function hasKnownManagementSession(endpoint: string) {
  try {
    return localStorage.getItem(discoveryKey(endpoint)) === '1'
  } catch {
    return false
  }
}
export function rememberManagementDiscovery(endpoint: string) {
  try {
    localStorage.setItem(discoveryKey(endpoint), '1')
  } catch {
    /* Discovery can still start from the login page. */
  }
}
const signedOut = new Set<string>()
const logoutKey = (endpoint: string) => `arcadia-management-signed-out:${endpoint}`
export function suppressManagementAccount(endpoint: string) {
  signedOut.add(endpoint)
  try {
    localStorage.removeItem(discoveryKey(endpoint))
  } catch {
    /* The signed-out preference remains active. */
  }
  try {
    sessionStorage.setItem(logoutKey(endpoint), '1')
  } catch {
    /* Keep the in-memory preference when storage is unavailable. */
  }
}
export function allowManagementAccount(endpoint: string) {
  signedOut.delete(endpoint)
  try {
    sessionStorage.removeItem(logoutKey(endpoint))
  } catch {
    /* The in-memory preference is still cleared. */
  }
}
function accountSuppressed(endpoint: string) {
  try {
    return signedOut.has(endpoint) || sessionStorage.getItem(logoutKey(endpoint)) === '1'
  } catch {
    return signedOut.has(endpoint)
  }
}
const pending = new Map<string, Promise<ManagementSessionInfo>>()
function once(key: string, run: () => Promise<ManagementSessionInfo>) {
  let task = pending.get(key)
  if (!task) {
    task = run()
    pending.set(key, task)
    void task
      .finally(() => {
        if (pending.get(key) === task) pending.delete(key)
      })
      .catch(() => {})
  }
  return task
}
/** Share cookie restoration across navigation and the console, then exchange any newly available account proof. */
export async function restoreManagementSession(client: ManagementClient, accountProof?: string) {
  const key = client.context.endpoint
  let session: ManagementSessionInfo
  try {
    session = await once(key, async () => {
      try {
        return await client.request<ManagementSessionInfo>('GET', '/session')
      } catch (error) {
        if (!(error instanceof ManagementError) || error.status !== 401) throw error
      }
      return client.request<ManagementSessionInfo>('POST', '/session/refresh', { body: {} })
    })
  } catch (error) {
    if (!(error instanceof ManagementError) || error.status !== 401 || !accountProof || accountSuppressed(key))
      throw error
    session = await once(`${key}:${accountProof}`, () =>
      client.request<ManagementSessionInfo>('POST', '/session/account', { accountProof, body: {} }),
    )
  }
  rememberManagementDiscovery(key)
  client.setCsrfToken(session.csrfToken)
  return session
}
export function managementSessionChanged() {
  window.dispatchEvent(new Event('management-session-changed'))
}
