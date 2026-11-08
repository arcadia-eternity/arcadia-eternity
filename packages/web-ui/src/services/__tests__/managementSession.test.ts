import { describe, expect, it, vi } from 'vitest'
import { ManagementError, type ManagementClient } from '../managementClient'
import { allowManagementAccount, restoreManagementSession, suppressManagementAccount } from '../managementSession'
const session = { principalId: 'owner', csrfToken: 'csrf', expiresAt: Date.now() + 1000 }
function client(endpoint: string, fn: (method: string, path: string) => Promise<unknown>) {
  return {
    context: { transport: 'http', endpoint, label: 'test' },
    request: vi.fn(fn),
    setCsrfToken: vi.fn(),
  } as unknown as ManagementClient
}
const unauthenticated = () => {
  throw new ManagementError('MANAGEMENT_UNAUTHENTICATED', 'login', 401)
}
describe('automatic management entry', () => {
  it('restores a valid session without asking for another account login', async () => {
    const current = client('https://restore.test', async () => session)
    await restoreManagementSession(current, 'player')
    expect(current.request).toHaveBeenCalledExactlyOnceWith('GET', '/session')
    expect(current.setCsrfToken).toHaveBeenCalledWith('csrf')
  })
  it('deduplicates remembered-device rotation for navigation and panel', async () => {
    const current = client('https://remember.test', async (_method, path) =>
      path === '/session' ? unauthenticated() : session,
    )
    await Promise.all([restoreManagementSession(current), restoreManagementSession(current)])
    expect(current.request).toHaveBeenCalledTimes(2)
    expect(current.request).toHaveBeenLastCalledWith('POST', '/session/refresh', { body: {} })
  })
  it('automatically exchanges a verified account, but preserves explicit logout', async () => {
    const endpoint = 'https://account.test'
    const current = client(endpoint, async (_method, path) =>
      path === '/session/account' ? session : unauthenticated(),
    )
    await restoreManagementSession(current, 'player')
    expect(current.request).toHaveBeenLastCalledWith('POST', '/session/account', { accountProof: 'player', body: {} })
    suppressManagementAccount(endpoint)
    await expect(restoreManagementSession(current, 'player')).rejects.toMatchObject({ status: 401 })
    allowManagementAccount(endpoint)
    await expect(restoreManagementSession(current, 'player')).resolves.toEqual(session)
  })
  it('uses an account proof that arrives while an anonymous restore is pending', async () => {
    let release!: () => void
    const wait = new Promise<void>(resolve => {
      release = resolve
    })
    const current = client('https://late-account.test', async (_method, path) => {
      if (path === '/session/account') return session
      await wait
      return unauthenticated()
    })
    const anonymous = restoreManagementSession(current).catch(error => error)
    const account = restoreManagementSession(current, 'new-player')
    release()
    expect(await anonymous).toMatchObject({ status: 401 })
    await expect(account).resolves.toEqual(session)
    expect(current.request).toHaveBeenCalledTimes(3)
  })

  it('does not turn network or permission failures into repeated login exchanges', async () => {
    const current = client('https://failure.test', async () => {
      throw new ManagementError('OFFLINE', 'offline', 503)
    })
    await expect(restoreManagementSession(current, 'player')).rejects.toMatchObject({ status: 503 })
    expect(current.request).toHaveBeenCalledTimes(1)
  })
})
