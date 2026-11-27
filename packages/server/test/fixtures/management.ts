import type { DurableStorage } from '@arcadia-eternity/database'
import type { ManagementAuth, ManagementSession } from '../../src/runtime/management/auth'

/** A valid credential of an active principal who is not on the administrator list. */
export async function nonAdministratorSession(
  auth: ManagementAuth,
  id = 'non-administrator',
  kind: 'session' | 'service' = 'service',
): Promise<ManagementSession> {
  const login = await auth.exchangeBootstrap((await auth.issueBootstrapCode(id)).code)
  const session =
    kind === 'service'
      ? {
          ...login,
          token: (await auth.createServiceToken(login.actor)).token,
        }
      : login
  const actor = kind === 'service' ? await auth.authenticate(session.token) : login.actor
  const store = (auth as unknown as { store: DurableStorage }).store
  const serverId = (auth as unknown as { options: { serverId: string } }).options.serverId
  const roster = (await store.get<{ principalIds: string[] }>('grants', `administrators:${serverId}`))!
  await store.replace('grants', roster.id, roster.revision, {
    ...roster.value,
    principalIds: roster.value.principalIds.filter(principal => principal !== id),
  })
  return { ...session, actor }
}
