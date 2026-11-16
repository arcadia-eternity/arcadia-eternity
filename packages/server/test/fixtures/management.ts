import { createHash } from 'node:crypto'
import type { DurableStorage } from '@arcadia-eternity/database'
import type { ManagementAuth, ManagementPermission, ManagementSession } from '../../src/runtime/management/auth'

/** Pre-upgrade service credential fixture. Production cannot issue new scoped credentials. */
export async function legacySession(
  auth: ManagementAuth,
  permissions: ManagementPermission[],
  id = 'legacy',
): Promise<ManagementSession> {
  const session = await auth.exchangeBootstrap((await auth.issueBootstrapCode(id)).code)
  const store = (auth as unknown as { store: DurableStorage }).store
  const row = (await store.get<Record<string, unknown>>(
    'credentials',
    createHash('sha256').update(session.token).digest('hex'),
  ))!
  const { serverId: _server, ...value } = row.value
  await store.replace('credentials', row.id, row.revision, { ...value, kind: 'service', permissions })
  return { ...session, actor: { ...session.actor, kind: 'service' } }
}
