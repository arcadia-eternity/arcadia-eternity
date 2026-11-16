import { afterEach, expect, it } from 'vitest'
import { io, type Socket } from 'socket.io-client'
import { createSingleProcessApp } from '../src/runtime/app'
import { AccountLoginSessions } from '../src/runtime/accounts/login-sessions'
import { SessionRegistry } from '../src/runtime/session'
import { openStorage, SQLAccountDirectory } from '@arcadia-eternity/database'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const apps: ReturnType<typeof createSingleProcessApp>[] = [],
  sockets: Socket[] = []
afterEach(async () => {
  for (const s of sockets.splice(0)) s.disconnect()
  for (const app of apps.splice(0)) await app.stop()
})
it('rejects public IDs and connected UID changes; detached changes get a fresh seat', async () => {
  const app = createSingleProcessApp({ port: 0, host: '127.0.0.1', serverId: 'profiles' })
  apps.push(app)
  await app.start()
  const origin = `http://127.0.0.1:${app.address!.port}`
  const session = await app.sessions.create({ id: 'old', name: 'Old' })
  const change = (token: string) =>
    fetch(`${origin}/api/v1/session/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ profile: { id: 'new', name: 'New' }, accountId: 'forged' }),
    })
  expect((await change(session.seatId)).status).toBe(401)
  const socket = io(origin, { transports: ['websocket'], auth: { token: session.token }, reconnection: false })
  sockets.push(socket)
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('connect_error', reject)
  })
  expect((await (await change(session.token)).json()).code).toBe('PROFILE_BUSY')
  socket.disconnect()
  await expect.poll(() => app.rooms.onlinePlayers).toBe(0)
  const response = await change(session.token)
  expect(response.status).toBe(200)
  const next = await response.json()
  expect(next.profile.id).toBe('new')
  expect(next.seatId).not.toBe(session.seatId)
  expect(next.sessionId).not.toBe(session.sessionId)
  expect(next.principal.kind).toBe('guest')
  expect(app.sessions.authenticate(session.token)?.profile.id).toBe('new')
})

it('persists a changed account profile across restart without changing account or expiry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'profile-account-'))
  const storage = await openStorage({ driver: 'sqlite', filename: join(directory, 'test.sqlite') })
  try {
    await storage.migrate()
    const account = await new SQLAccountDirectory(storage, 'server').resolveOrCreate({
      providerId: 'email',
      issuer: 'mailto',
      subject: 'fixture@example.test',
      verifiedAt: Date.now(),
    })
    const sessions = new SessionRegistry({ serverId: 'server', accountEnabled: true })
    const logins = new AccountLoginSessions(storage, sessions)
    const original = sessions.issueVerifiedAccount({ id: 'old', name: 'Old' }, account.accountId)
    await logins.remember(original)
    await logins.replaceProfile(original.token, { id: 'new', name: 'New' })
    const changed = sessions.replaceProfile(original.token, { id: 'new', name: 'New' })
    expect(changed.principal).toEqual(original.principal)
    const restored = await new AccountLoginSessions(
      storage,
      new SessionRegistry({ serverId: 'server', accountEnabled: true }),
    ).resume(original.token)
    expect(restored?.profile.id).toBe('new')
    expect(restored?.principal).toEqual(original.principal)
    expect(restored?.expiresAt).toBe(original.expiresAt)
  } finally {
    await storage.close()
    await rm(directory, { recursive: true, force: true })
  }
})
