import { describe, expect, it } from 'vitest'
import { isManagementTransportTrusted } from '../src/standalone/management/http'

describe('management TLS and explicit proxy boundary', () => {
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
