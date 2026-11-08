import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isoCBOR } from '@simplewebauthn/server/helpers'
import { openStorage, type DurableStorage } from '@arcadia-eternity/database'
import { ManagementAuth, MANAGEMENT_ACTIONS, type ManagementSession } from '../src/runtime/management/auth'

const origin = 'https://admin.example.test'
const scope = { kind: 'server' as const, id: 'server' }
const digest = (input: string | Buffer) => createHash('sha256').update(input).digest()
/** A real ES256 authenticator fixture: no mocked signature verifier. */
function authenticator() {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = pair.publicKey.export({ format: 'jwk' })
  const id = randomBytes(32)
  const publicKey = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x!, 'base64url')],
      [-3, Buffer.from(jwk.y!, 'base64url')],
    ]),
  )
  function data(challenge: string, type: string, site = origin) {
    return Buffer.from(JSON.stringify({ type, challenge, origin: site, crossOrigin: false }))
  }
  return {
    registration(challenge: string) {
      const length = Buffer.alloc(2)
      length.writeUInt16BE(id.length)
      const authData = Buffer.concat([
        digest(new URL(origin).hostname),
        Buffer.from([0x45]),
        Buffer.alloc(4),
        Buffer.alloc(16),
        length,
        id,
        publicKey,
      ])
      return {
        id: id.toString('base64url'),
        rawId: id.toString('base64url'),
        type: 'public-key' as const,
        clientExtensionResults: {},
        response: {
          clientDataJSON: data(challenge, 'webauthn.create').toString('base64url'),
          attestationObject: Buffer.from(
            isoCBOR.encode(
              new Map<string, string | Uint8Array | Map<string, string>>([
                ['fmt', 'none'],
                ['attStmt', new Map()],
                ['authData', authData],
              ]),
            ),
          ).toString('base64url'),
        },
      }
    },
    authentication(challenge: string, count = 1, site = origin, flags = 0x05) {
      const counter = Buffer.alloc(4)
      counter.writeUInt32BE(count)
      const authData = Buffer.concat([digest(new URL(origin).hostname), Buffer.from([flags]), counter])
      const clientData = data(challenge, 'webauthn.get', site)
      return {
        id: id.toString('base64url'),
        rawId: id.toString('base64url'),
        type: 'public-key' as const,
        clientExtensionResults: {},
        response: {
          clientDataJSON: clientData.toString('base64url'),
          authenticatorData: authData.toString('base64url'),
          signature: sign('sha256', Buffer.concat([authData, digest(clientData)]), pair.privateKey).toString(
            'base64url',
          ),
        },
      }
    },
  }
}

describe('management passkeys and remembered devices', () => {
  let directory: string, store: DurableStorage, auth: ManagementAuth, owner: ManagementSession, now: number
  beforeEach(async () => {
    now = Date.now()
    directory = await mkdtemp(join(tmpdir(), 'management-login-'))
    store = openStorage({ driver: 'sqlite', filename: join(directory, 'state.sqlite') })
    await store.migrate()
    auth = new ManagementAuth(store, { now: () => now })
    owner = await auth.exchangeBootstrap(
      (await auth.issueBootstrapCode([{ scope, actions: [...MANAGEMENT_ACTIONS.server] }])).code,
    )
  })
  afterEach(async () => {
    await store.close()
    await rm(directory, { recursive: true, force: true })
  })
  async function register() {
    const key = authenticator()
    const request = await auth.passkeyRegistrationOptions(owner.actor, origin)
    await auth.registerPasskey(owner.actor, origin, {
      challengeId: request.challengeId,
      response: key.registration(request.options.challenge),
      label: 'Laptop',
    })
    return key
  }
  it('signs in using a real passkey, rejects replay, and revokes derived sessions with the passkey', async () => {
    const key = await register()
    const request = await auth.passkeyLoginOptions(origin)
    const input = { challengeId: request.challengeId, response: key.authentication(request.options.challenge) }
    const session = await auth.loginPasskey(origin, input)
    await expect(auth.authorize(session.actor, scope, 'read')).resolves.toBeUndefined()
    await expect(auth.loginPasskey(origin, input)).rejects.toMatchObject({ status: 401 })
    const [method] = await auth.loginMethods(owner.actor)
    await auth.revokeLoginMethod(owner.actor, method.id)
    await expect(auth.authenticate(session.token)).rejects.toMatchObject({ status: 401 })
  })
  it.each(['signature', 'origin', 'challenge', 'user-verification'] as const)(
    'rejects a forged %s assertion',
    async attack => {
      const key = await register()
      const request = await auth.passkeyLoginOptions(origin)
      const response = key.authentication(
        attack === 'challenge' ? 'wrong' : request.options.challenge,
        1,
        attack === 'origin' ? 'https://evil.test' : origin,
        attack === 'user-verification' ? 1 : 5,
      )
      if (attack === 'signature') response.response.signature = randomBytes(70).toString('base64url')
      await expect(auth.loginPasskey(origin, { challengeId: request.challengeId, response })).rejects.toMatchObject({
        status: 401,
      })
    },
  )
  it('rejects unknown credentials and registration by a forged session', async () => {
    await expect(
      auth.passkeyRegistrationOptions({ ...owner.actor, principalId: 'forged' }, origin),
    ).rejects.toMatchObject({ status: 401 })
    const request = await auth.passkeyLoginOptions(origin)
    await expect(
      auth.loginPasskey(origin, {
        challengeId: request.challengeId,
        response: authenticator().authentication(request.options.challenge),
      }),
    ).rejects.toMatchObject({ status: 401 })
    for (const token of [
      'ae_mgt_forged',
      owner.token + 'x',
      owner.actor.credentialId,
      'eyJhbGciOiJub25lIn0.eyJyb2xlIjoiYWRtaW4ifQ.',
    ])
      await expect(auth.authenticate(token)).rejects.toMatchObject({ status: 401 })
  })
  it('binds registration challenges to the verified session and rejects expired challenges and service tokens', async () => {
    const key = authenticator()
    const request = await auth.passkeyRegistrationOptions(owner.actor, origin)
    const other = await auth.exchangeBootstrap((await auth.issueBootstrapCode([{ scope, actions: ['read'] }])).code)
    await expect(
      auth.registerPasskey(other.actor, origin, {
        challengeId: request.challengeId,
        response: key.registration(request.options.challenge),
        label: 'Forged binding',
      }),
    ).rejects.toMatchObject({ status: 401 })
    const expired = await auth.passkeyRegistrationOptions(owner.actor, origin)
    now += 301_000
    await expect(
      auth.registerPasskey(owner.actor, origin, {
        challengeId: expired.challengeId,
        response: key.registration(expired.options.challenge),
        label: 'Expired',
      }),
    ).rejects.toMatchObject({ status: 401 })
    const service = await auth.createServiceToken(owner.actor, { permissions: [{ scope, actions: ['read'] }] })
    await expect(auth.passkeyRegistrationOptions(await auth.authenticate(service.token), origin)).rejects.toMatchObject(
      { code: 'SESSION_REQUIRED' },
    )
  })

  it('rotates remembered credentials, retains a fixed expiry and rejects reused or tampered tokens', async () => {
    const device = await auth.rememberDevice(owner.actor, 'Browser')
    await expect(auth.authenticate(device.token)).rejects.toMatchObject({ status: 401 })
    await expect(auth.refreshDevice(device.token + 'x')).rejects.toMatchObject({ status: 401 })
    now += 9 * 3600_000
    const refreshed = await auth.refreshDevice(device.token)
    expect(refreshed.token).not.toBe(device.token)
    expect(refreshed.expiresAt).toBe(device.expiresAt)
    await expect(auth.refreshDevice(device.token)).rejects.toMatchObject({ status: 401 })
    await expect(auth.authenticate(refreshed.session.token)).resolves.toBeDefined()
    expect(JSON.stringify(await store.exportSnapshot())).not.toContain(refreshed.token)
    now = device.expiresAt
    await expect(auth.refreshDevice(refreshed.token)).rejects.toMatchObject({ status: 401 })
  })
  it('logout and device revocation invalidate remembered access and derived sessions', async () => {
    const device = await auth.rememberDevice(owner.actor, 'Browser')
    const refreshed = await auth.refreshDevice(device.token)
    await auth.logoutSession(refreshed.session.actor)
    await expect(auth.refreshDevice(refreshed.token)).rejects.toMatchObject({ status: 401 })
    await expect(auth.authenticate(owner.token)).rejects.toMatchObject({ status: 401 })
    await expect(auth.authenticate(refreshed.session.token)).rejects.toMatchObject({ status: 401 })
  })
  it('cannot turn a restricted session into broader passkey or remembered-device rights', async () => {
    const limited = await auth.exchangeBootstrap((await auth.issueBootstrapCode([{ scope, actions: ['read'] }])).code)
    const key = authenticator(),
      request = await auth.passkeyRegistrationOptions(limited.actor, origin)
    await auth.registerPasskey(limited.actor, origin, {
      challengeId: request.challengeId,
      response: key.registration(request.options.challenge),
      label: 'Read only',
    })
    const challenge = await auth.passkeyLoginOptions(origin)
    const session = await auth.loginPasskey(origin, {
      challengeId: challenge.challengeId,
      response: key.authentication(challenge.options.challenge),
    })
    await expect(auth.authorize(session.actor, scope, 'settings.manage')).rejects.toMatchObject({ status: 403 })
    const device = await auth.rememberDevice(session.actor, 'Read only browser')
    const refreshed = await auth.refreshDevice(device.token)
    await expect(auth.authorize(refreshed.session.actor, scope, 'settings.manage')).rejects.toMatchObject({
      status: 403,
    })
    const grants = await auth.listGrants(owner.actor, scope)
    await auth.revokeGrant(owner.actor, grants[0].id, grants[0].revision)
    await expect(auth.refreshDevice(refreshed.token)).rejects.toMatchObject({ status: 403 })
  })
})
