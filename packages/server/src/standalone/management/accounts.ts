import { randomUUID } from 'node:crypto'
import type { AccountDirectory, DurableStorage } from '@arcadia-eternity/database'
import type { ServerSession } from '@arcadia-eternity/protocol'
import { SessionRegistry } from '../session'
import { ManagementAuth, ManagementAuthError, type ManagementActor, type ManagementScope } from './auth'

export class ManagementAccountError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code)
  }
}
export interface ManagementAccountOptions {
  serverId: string
  directory?: AccountDirectory
  sessions: SessionRegistry
  /** The same room/socket revocation path used by self-service account deactivation. */
  revokeSession(session: ServerSession): Promise<void>
}

const accountIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function accountId(value: unknown): string {
  if (typeof value !== 'string' || !accountIdPattern.test(value))
    throw new ManagementAccountError('ACCOUNT_NOT_FOUND', 404)
  return value
}

/** Server-scoped account administration. Profile IDs and identity proofs never enter this API. */
export class ManagementAccounts {
  readonly scope: ManagementScope
  private readonly pendingRevocations = new Map<string, ServerSession[]>()
  constructor(
    private readonly storage: DurableStorage,
    private readonly options: ManagementAccountOptions,
    private readonly auth: ManagementAuth,
  ) {
    if (options.sessions.serverId !== options.serverId) throw new Error('ACCOUNT_SESSION_SCOPE_MISMATCH')
    this.scope = { kind: 'server', id: options.serverId }
  }
  get enabled() {
    return !!this.options.directory
  }
  private requireEnabled() {
    if (!this.enabled) throw new ManagementAccountError('ACCOUNTS_UNAVAILABLE', 409)
  }
  async list(actor: ManagementActor, input: { limit?: number; cursor?: string } = {}) {
    this.requireEnabled()
    const limit = input.limit ?? 50
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new ManagementAccountError('INVALID_PAGE_LIMIT', 422)
    const cursor = input.cursor === undefined ? undefined : accountId(input.cursor)
    return this.storage.transaction(async tx => {
      await this.auth.authorizeInTransaction(tx, actor, this.scope, 'accounts.manage')
      const accounts = await tx.listAccounts(this.options.serverId, { limit, ...(cursor ? { cursor } : {}) })
      return {
        accounts,
        // A full page has a continuation even if the next page happens to be empty.
        ...(accounts.length === limit ? { nextCursor: accounts[accounts.length - 1].accountId } : {}),
      }
    })
  }
  async status(actor: ManagementActor, id: string) {
    this.requireEnabled()
    const target = accountId(id)
    return this.storage.transaction(async tx => {
      await this.auth.authorizeInTransaction(tx, actor, this.scope, 'accounts.manage')
      const account = await tx.accountDetails(this.options.serverId, target)
      if (!account) throw new ManagementAccountError('ACCOUNT_NOT_FOUND', 404)
      return account
    })
  }
  private async revokeLive(account: string) {
    const revoked = [
      ...new Map(
        [...(this.pendingRevocations.get(account) ?? []), ...this.options.sessions.blockAccount(account)].map(
          session => [session.token, session],
        ),
      ).values(),
    ]
    const results = await Promise.allSettled(revoked.map(session => this.options.revokeSession(session)))
    const failed = revoked.filter((_session, index) => results[index].status === 'rejected')
    if (failed.length) {
      this.pendingRevocations.set(account, failed)
      throw new ManagementAccountError('ACCOUNT_REVOCATION_FAILED', 503)
    }
    this.pendingRevocations.delete(account)
  }
  async deactivate(actor: ManagementActor, id: string) {
    this.requireEnabled()
    const target = accountId(id)
    try {
      await this.storage.transaction(async tx => {
        // Authority and the account transition serialize with revocation/login in the same transaction.
        await this.auth.authorizeInTransaction(tx, actor, this.scope, 'accounts.manage')
        if (!(await tx.deactivateAccount(this.options.serverId, target)))
          throw new ManagementAccountError('ACCOUNT_NOT_FOUND', 404)
        await tx.create('audit', {
          id: randomUUID(),
          scope: `server:${this.options.serverId}`,
          value: {
            actor: actor.principalId,
            action: 'account.deactivate',
            target,
            createdAt: Date.now(),
          },
        })
      })
    } catch (error) {
      if (
        error instanceof ManagementAuthError ||
        error instanceof ManagementAccountError ||
        (error as { code?: string }).code === 'REVISION_CONFLICT'
      )
        throw error
      // Match the existing G3 deactivation behavior when COMMIT acknowledgement is lost.
      let status: 'active' | 'deactivated' | null | undefined
      try {
        status = await this.storage.accountStatus(this.options.serverId, target)
      } catch {
        /* Uncertain outcome. */
      }
      if (status === 'active') throw error
      if (status !== 'deactivated') {
        await this.revokeLive(target).catch(() => undefined)
        throw error
      }
    }
    await this.revokeLive(target)
    return { accountId: target, status: 'deactivated' as const }
  }
}
