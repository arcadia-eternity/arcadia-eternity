import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { describe, expect, it, vi } from 'vitest'
import { isManagementTransportTrusted, mountManagementApi } from '../src/runtime/management/http'
import type { ManagementService } from '../src/runtime/management/service'
import { SessionRegistry } from '../src/runtime/session'

async function managementRequest(options: Partial<Parameters<typeof mountManagementApi>[2]> = {}, login = false) {
  const app = express()
  app.use((req, _res, next) => {
    Object.defineProperty(req.socket, 'remoteAddress', { value: '192.0.2.10', configurable: true })
    next()
  })
  const exchangeBootstrap = vi.fn().mockResolvedValue({
    actor: { principalId: 'owner' },
    token: 'session-token',
    csrfToken: 'csrf-token',
    expiresAt: Date.now() + 60_000,
  })
  const service = {
    options: { serverId: 'server', workspace: { workspaceId: 'workspace' } },
    capabilities: async () => ({ serverId: 'server' }),
    auth: { exchangeBootstrap },
  } as unknown as ManagementService
  mountManagementApi(app, service, {
    acceptsOrigin: () => true,
    secureCookies: true,
    sessions: new SessionRegistry({ serverId: 'server' }),
    ...options,
  })
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const { port } = server.address() as AddressInfo
    const route = login ? 'session/bootstrap' : 'capabilities'
    const response = await fetch(`http://127.0.0.1:${port}/api/management/v1/${route}`, {
      headers: { 'X-Forwarded-Proto': 'https', 'Content-Type': 'application/json' },
      ...(login ? { method: 'POST', body: JSON.stringify({ code: 'bootstrap-code' }) } : {}),
    })
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie') }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
  }
}

describe('management TLS and explicit proxy boundary', () => {
  it('lets a deployment terminate TLS at the edge by default and supports enforcing it in the app', async () => {
    const publicOrigin = 'https://server.test'
    const trustedProxyAddresses = ['192.0.2.11']
    expect((await managementRequest({ publicOrigin })).status).toBe(200)
    expect(await managementRequest({ publicOrigin, requireTls: true })).toMatchObject({
      status: 403,
      body: { error: { code: 'MANAGEMENT_TLS_REQUIRED' } },
    })
    expect((await managementRequest({ publicOrigin, trustedProxyAddresses })).status).toBe(403)
    expect((await managementRequest({ publicOrigin, trustedProxyAddresses, requireTls: false })).status).toBe(200)
  })

  it('issues Lax cookies by default and secure partitioned cookies for cross-site management', async () => {
    const defaults = await managementRequest({}, true)
    expect(defaults.status).toBe(200)
    expect(defaults.cookie).toContain('; HttpOnly; SameSite=Lax;')
    expect(defaults.cookie).toMatch(/; Secure$/)

    const crossSite = await managementRequest({ cookieSameSite: 'none', secureCookies: false }, true)
    expect(crossSite.status).toBe(200)
    expect(crossSite.cookie).toMatch(/^arcadia_management_partitioned=/)
    expect(crossSite.cookie).toContain('; HttpOnly; SameSite=None;')
    expect(crossSite.cookie).toMatch(/; Secure; Partitioned$/)

    const strict = await managementRequest({ cookieSameSite: 'strict' }, true)
    expect(strict.cookie).toContain('; SameSite=Strict;')
  })

  it('accepts local private traffic and native TLS without trusting forwarded headers', () => {
    for (const remoteAddress of ['127.0.0.1', '127.0.0.2', '::1', '::ffff:127.0.0.1'])
      expect(isManagementTransportTrusted({ remoteAddress })).toBe(true)
    expect(isManagementTransportTrusted({ remoteAddress: '192.0.2.2', encrypted: true })).toBe(true)
  })
  it('rejects remote plaintext even when a client spoofs HTTPS forwarding', () => {
    for (const forwardedProto of [undefined, 'https', ['https'], 'https,http'])
      expect(
        isManagementTransportTrusted({
          remoteAddress: '192.0.2.2',
          forwardedProto,
          publicOrigin: 'https://server.test',
        }),
      ).toBe(false)
  })
  it('requires both an exact trusted proxy address and configured public HTTPS origin', () => {
    const trustedProxyAddresses = ['192.0.2.10']
    expect(
      isManagementTransportTrusted({
        remoteAddress: '::ffff:192.0.2.10',
        trustedProxyAddresses,
        forwardedProto: 'https',
        publicOrigin: 'https://server.test',
      }),
    ).toBe(true)
    expect(
      isManagementTransportTrusted({
        remoteAddress: '192.0.2.11',
        trustedProxyAddresses,
        forwardedProto: 'https',
        publicOrigin: 'https://server.test',
      }),
    ).toBe(false)
    expect(
      isManagementTransportTrusted({
        remoteAddress: '192.0.2.10',
        trustedProxyAddresses,
        forwardedProto: 'https',
        publicOrigin: 'http://server.test',
      }),
    ).toBe(false)
    expect(
      isManagementTransportTrusted({
        remoteAddress: '192.0.2.10',
        trustedProxyAddresses,
        forwardedProto: ['https'],
        publicOrigin: 'https://server.test',
      }),
    ).toBe(false)
    expect(
      isManagementTransportTrusted({
        remoteAddress: '192.0.2.10',
        trustedProxyAddresses,
        publicOrigin: 'https://server.test',
      }),
    ).toBe(false)
  })
  it('does not accept missing or vaguely local-looking peer identities', () => {
    for (const remoteAddress of [undefined, 'localhost', '127.evil.test', '10.0.0.1'])
      expect(isManagementTransportTrusted({ remoteAddress })).toBe(false)
  })
})
