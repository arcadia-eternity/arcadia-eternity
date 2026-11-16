import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openStorage, SQLAccountDirectory } from '@arcadia-eternity/database'
import { ContentWorkspace } from '@arcadia-eternity/content-sdk/management-workspace'
import { createSingleProcessApp } from '../src/runtime/app'
import { legacySession } from './fixtures/management'
const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'administrator-http-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const storage = openStorage({ driver: 'sqlite', filename: join(root, 'server.sqlite') })
  cleanups.push(() => storage.close())
  await storage.migrate()
  const workspace = await ContentWorkspace.open(join(root, 'workspace'))
  cleanups.push(() => workspace.close())
  const directory = new SQLAccountDirectory(storage, 'server')
  const unavailable = async (): Promise<never> => {
    throw Error('Unused provider')
  }
  const app = createSingleProcessApp({
    serverId: 'server',
    host: '127.0.0.1',
    port: 0,
    corsOrigins: ['http://admin.test'],
    accounts: {
      directory,
      email: { providerId: 'email', begin: unavailable, verify: unavailable },
      github: { providerId: 'github', callbackOrigins: ['http://admin.test'], begin: unavailable, verify: unavailable },
    },
    management: { storage, workspace },
  })
  cleanups.push(() => app.stop())
  await app.start()
  const service = app.management!,
    auth = service.auth
  const owner = await auth.exchangeBootstrap((await auth.issueBootstrapCode()).code)
  const account = await directory.resolveOrCreate({
    providerId: 'email',
    issuer: 'mailto',
    subject: 'admin@example.test',
    verifiedAt: Date.now(),
  })
  return { storage, workspace, app, directory, service, auth, owner, account }
}
describe('administrator management entry points', () => {
  it('adds an account as administrator in one request and removes old grant endpoints', async () => {
    const f = await fixture()
    const list = await f.auth.listAdministrators(f.owner.actor)
    const result = await f.service.request(f.owner.actor, {
      method: 'POST',
      path: '/administrators',
      body: { accountId: f.account.accountId },
      headers: { 'if-match': String(list.revision) },
    })
    expect(result.status).toBe(201)
    const login = await f.auth.exchangeAccount('server', f.account.accountId)
    await expect(f.auth.authorize(login.actor, f.service.workspaceScope, 'edit')).resolves.toBeUndefined()
    for (const path of ['/grants', '/principals'])
      await expect(f.service.request(f.owner.actor, { method: 'POST', path, body: {} })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
  })
  it('returns an actionable 409 when the last administrator deactivates their player account', async () => {
    const f = await fixture()
    const { principalId } = await f.auth.addAdministrator(
      f.owner.actor,
      { accountId: f.account.accountId },
      (await f.auth.listAdministrators(f.owner.actor)).revision,
    )
    const login = await f.auth.exchangeAccount('server', f.account.accountId)
    await f.auth.removeAdministrator(
      login.actor,
      f.owner.actor.principalId,
      (await f.auth.listAdministrators(f.owner.actor)).revision,
    )
    const player = f.app.sessions.issueVerifiedAccount({ id: 'player', name: 'Admin' }, f.account.accountId)
    const response = await fetch(`http://127.0.0.1:${f.app.address!.port}/api/v1/account`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${player.token}`, Origin: 'http://admin.test' },
    })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ code: 'LAST_ADMINISTRATOR' })
    expect(await f.directory.getStatus(f.account.accountId)).toBe('active')
    expect((await f.auth.listAdministrators(login.actor)).administrators.map(a => a.principalId)).toEqual([principalId])
  })
  it('keeps old server-only service credentials from seeing workspace tasks', async () => {
    const f = await fixture()
    const legacy = await legacySession(f.auth, [{ scope: f.service.serverScope, actions: ['read'] }])
    for (const scope of ['server:server', `workspace:${f.workspace.workspaceId}`])
      await f.storage.create('operations', {
        id: scope,
        scope,
        value: {
          scope,
          ownerId: `${f.workspace.workspaceId}:server`,
          actor: f.owner.actor,
          kind: 'test',
          status: 'succeeded',
          createdAt: 1,
          updatedAt: 1,
        },
      })
    const result = await f.service.request(legacy.actor, { method: 'GET', path: '/operations' })
    expect((result.body as { operations: { id: string }[] }).operations.map(op => op.id)).toEqual(['server:server'])
  })
  it('recovers trusted local management immediately after its cached owner membership is removed', async () => {
    const f = await fixture()
    expect((await f.service.localRequest({ method: 'GET', path: '/capabilities' })).status).toBe(200)
    const list = await f.auth.listAdministrators(f.owner.actor)
    await f.auth.removeAdministrator(f.owner.actor, 'local-owner:server', list.revision)
    const result = await f.service.localRequest({ method: 'GET', path: '/capabilities' })
    expect(result.body).toMatchObject({ isAdministrator: true })
  })
})
