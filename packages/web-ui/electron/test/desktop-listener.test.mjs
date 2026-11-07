import { test } from 'node:test'
import assert from 'node:assert/strict'
import { desktopListener } from '../desktop-listener.mjs'

const interfaces = {
  lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
  en0: [{ family: 'IPv4', address: '192.168.8.4', internal: false }],
  en1: [{ family: 'IPv4', address: '169.254.7.4', internal: false }],
}
const ready = (host, extra = {}) => ({ type: 'arcadia.desktop.listener', serverId: 'test', host, port: 8123, ...extra })
test('wildcard listeners report usable local and LAN addresses, never wildcard invitations', () => {
  const value = desktopListener(ready('0.0.0.0'), 'test', interfaces)
  assert.equal(value.url, 'http://127.0.0.1:8123')
  assert.equal(value.network.scope, 'network')
  assert.deepEqual(value.network.availableHosts, ['192.168.8.4'])
  assert.deepEqual(value.network.inviteUrls, ['http://192.168.8.4:8123'])
  assert.deepEqual(desktopListener(ready('0.0.0.0'), 'test', {}).network.inviteUrls, [])
})
test('loopback is private by default and declared proxy origins do not become bind hosts', () => {
  assert.deepEqual(desktopListener(ready('127.0.0.1'), 'test', interfaces).network.inviteUrls, [])
  const value = desktopListener(ready('127.0.0.1', { publicOrigin: 'https://play.example.com' }), 'test', interfaces)
  assert.equal(value.url, 'http://127.0.0.1:8123')
  assert.deepEqual(value.network.inviteUrls, ['https://play.example.com'])
  assert.deepEqual(
    desktopListener(ready('0.0.0.0', { publicOrigin: 'http://0.0.0.0:8123' }), 'test', interfaces).network.inviteUrls,
    ['http://192.168.8.4:8123'],
  )
})
test('explicit interfaces and IPv6 addresses stay distinct from their proxy address', () => {
  const value = desktopListener(ready('192.168.8.4', { publicOrigin: 'https://play.example.com' }), 'test', interfaces)
  assert.equal(value.url, 'http://192.168.8.4:8123')
  assert.deepEqual(value.network.inviteUrls, ['https://play.example.com', 'http://192.168.8.4:8123'])
  assert.equal(desktopListener(ready('::1'), 'test', interfaces).url, 'http://[::1]:8123')
  assert.equal(desktopListener(ready('::'), 'test', interfaces).url, 'http://[::1]:8123')
})
test('rejects malformed or foreign child readiness before issuing a health request', () => {
  for (const update of [
    { serverId: 'other' },
    { port: 0 },
    { port: 65536 },
    { port: '8123' },
    { host: 'user@192.168.8.4' },
    { host: 'example.com/path' },
    { publicOrigin: 'https://user:secret@example.com' },
    { publicOrigin: 'file:///private/file' },
    { publicOrigin: 'https://example.com/path' },
  ])
    assert.throws(() => desktopListener(ready('127.0.0.1', update), 'test', interfaces))
})
