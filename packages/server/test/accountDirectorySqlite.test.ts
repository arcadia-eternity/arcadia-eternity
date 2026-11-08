import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openStorage } from '@arcadia-eternity/database'
import { SQLAccountDirectory } from '../src/runtime/accounts/directory'

const email = (subject: string) => ({ providerId: 'email', issuer: 'mailto', subject, verifiedAt: 1_793_808_123_000 })
const github = (subject: string) => ({
  providerId: 'github',
  issuer: 'https://github.com',
  subject,
  verifiedAt: 1_793_808_123_000,
})

describe('SQLite account directory contract', () => {
  let directory: string
  let filename: string
  let storage: Awaited<ReturnType<typeof openStorage>>
  let accounts: SQLAccountDirectory

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arcadia-accounts-sqlite-'))
    filename = join(directory, 'accounts.sqlite')
    storage = await openStorage({ driver: 'sqlite', filename })
    await storage.migrate()
    accounts = new SQLAccountDirectory(storage, 'stable-server')
  })

  afterEach(async () => {
    await storage?.close()
    if (directory) await rm(directory, { recursive: true, force: true })
  })

  it('resolves concurrent first logins to one persistent account', async () => {
    const identity = email('first@example.com')
    const results = await Promise.all(Array.from({ length: 24 }, () => accounts.resolveOrCreate(identity)))
    expect(new Set(results.map(account => account.accountId)).size).toBe(1)
    expect(results.every(account => account.status === 'active')).toBe(true)
    expect(await accounts.list(results[0].accountId)).toEqual([identity])

    await storage.close()
    storage = await openStorage({ driver: 'sqlite', filename })
    await storage.checkSchema()
    accounts = new SQLAccountDirectory(storage, 'stable-server')
    expect(await accounts.resolveOrCreate(identity)).toEqual(results[0])
  })

  it('keeps the same external identity in different server account spaces', async () => {
    const identity = github('same-subject')
    const otherServer = new SQLAccountDirectory(storage, 'other-server')
    const local = await accounts.resolveOrCreate(identity)
    const other = await otherServer.resolveOrCreate(identity)
    expect(local.accountId).not.toBe(other.accountId)
    expect(await accounts.getStatus(other.accountId)).toBeNull()
    await expect(accounts.link(other.accountId, email('cross-server@example.com'))).rejects.toMatchObject({
      code: 'ACCOUNT_NOT_FOUND',
    })
  })

  it('preserves accounts, verified identities and deactivation through a portable snapshot', async () => {
    const activeIdentity = email('export-active@example.com')
    const active = await accounts.resolveOrCreate(activeIdentity)
    const linked = github('export-active')
    await accounts.link(active.accountId, linked)
    const inactiveIdentity = email('export-disabled@example.com')
    const inactive = await accounts.resolveOrCreate(inactiveIdentity)
    await accounts.deactivate(inactive.accountId)
    const destination = await openStorage({ driver: 'sqlite', filename: join(directory, 'restored.sqlite') })
    try {
      await destination.migrate()
      await destination.importSnapshot(await storage.exportSnapshot())
      const restored = new SQLAccountDirectory(destination, 'stable-server')
      expect(await restored.resolveOrCreate(activeIdentity)).toEqual(active)
      expect(await restored.list(active.accountId)).toEqual([activeIdentity, linked])
      expect(await restored.getStatus(inactive.accountId)).toBe('deactivated')
      await expect(restored.resolveOrCreate(inactiveIdentity)).rejects.toMatchObject({ code: 'ACCOUNT_DEACTIVATED' })
    } finally {
      await destination.close()
    }
  })

  it('requires explicit linking, rejects another owner, and protects the last recovery method', async () => {
    const identity = email('owner@example.com')
    const owner = await accounts.resolveOrCreate(identity)
    const other = await accounts.resolveOrCreate(email('other@example.com'))
    const second = github('owner')
    await accounts.link(owner.accountId, second)
    await accounts.link(owner.accountId, second)
    await expect(accounts.link(other.accountId, second)).rejects.toMatchObject({ code: 'IDENTITY_CONFLICT' })
    expect(await accounts.list(owner.accountId)).toEqual([identity, second])
    await accounts.unlink(owner.accountId, identity)
    await expect(accounts.unlink(owner.accountId, second)).rejects.toMatchObject({ code: 'LAST_RECOVERY_METHOD' })
    expect(await accounts.resolveOrCreate(second)).toEqual(owner)
  })

  it('serializes competing unlinks so an account remains recoverable', async () => {
    const first = email('recoverable@example.com')
    const second = github('recoverable')
    const account = await accounts.resolveOrCreate(first)
    await accounts.link(account.accountId, second)
    const results = await Promise.allSettled([
      accounts.unlink(account.accountId, first),
      accounts.unlink(account.accountId, second),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toMatchObject([
      { reason: { code: 'LAST_RECOVERY_METHOD' } },
    ])
    expect(await accounts.list(account.accountId)).toHaveLength(1)
  })

  it('does not issue a session for an identity unlinked or reassigned after login resolution', async () => {
    const identity = email('stale@example.com')
    const original = await accounts.resolveOrCreate(identity)
    await accounts.link(original.accountId, github('original'))
    await accounts.unlink(original.accountId, identity)
    const issue = vi.fn(() => 'session')
    await expect(accounts.withActiveIdentity(original.accountId, identity, issue)).rejects.toMatchObject({
      code: 'IDENTITY_NOT_FOUND',
    })
    const other = await accounts.resolveOrCreate(github('other'))
    await accounts.link(other.accountId, identity)
    await expect(accounts.withActiveIdentity(original.accountId, identity, issue)).rejects.toMatchObject({
      code: 'IDENTITY_NOT_FOUND',
    })
    expect(issue).not.toHaveBeenCalled()
    expect(await accounts.withActiveIdentity(other.accountId, identity, issue)).toBe('session')
  })

  it('serializes session issuance and deactivation while retaining identity ownership', async () => {
    const identity = email('deactivate@example.com')
    const account = await accounts.resolveOrCreate(identity)
    let entered!: () => void
    let release!: () => void
    const started = new Promise<void>(resolve => {
      entered = resolve
    })
    const released = new Promise<void>(resolve => {
      release = resolve
    })
    const session = accounts.withActiveAccount(account.accountId, async () => {
      entered()
      await released
      return 'issued'
    })
    await started
    const deactivation = accounts.deactivate(account.accountId)
    release()
    expect(await session).toBe('issued')
    await deactivation
    await accounts.deactivate(account.accountId)
    expect(await accounts.getStatus(account.accountId)).toBe('deactivated')
    await expect(accounts.resolveOrCreate(identity)).rejects.toMatchObject({ code: 'ACCOUNT_DEACTIVATED' })
    const late = vi.fn(() => 'late')
    await expect(accounts.withActiveAccount(account.accountId, late)).rejects.toMatchObject({
      code: 'ACCOUNT_DEACTIVATED',
    })
    expect(late).not.toHaveBeenCalled()
  })

  it('rejects malformed identity proofs before writing account state', async () => {
    await expect(accounts.resolveOrCreate(email('invalid\n@example.com'))).rejects.toMatchObject({
      code: 'INVALID_IDENTITY',
    })
    await expect(accounts.resolveOrCreate({ ...email('valid@example.com'), verifiedAt: -1 })).rejects.toMatchObject({
      code: 'INVALID_IDENTITY',
    })
    await expect(accounts.getStatus('local-profile-id')).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' })
  })
})
