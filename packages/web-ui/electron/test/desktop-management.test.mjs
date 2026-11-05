import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { managementRequest } from '../desktop-management.mjs'
import { loadLocalServerProfile, saveLocalServerProject } from '../local-server-profile.mjs'

test('management IPC accepts only resource requests, not endpoint or credential overrides', () => {
  const input = { method: 'PATCH', path: '/servers/local', headers: { 'If-Match': '3' }, body: { name: 'My server' } }
  const result = managementRequest(input)
  assert.deepEqual(result.headers, { 'if-match': '3' })
  input.body.name = 'Changed after request'
  assert.equal(result.body.name, 'My server')
  for (const path of [
    'https://example.test/',
    '//example.test/',
    '/foo/../secret',
    '/foo/%2e%2e/secret',
    '/foo%5csecret',
    '/foo%2f%2fsecret',
    '/bad\n',
  ])
    assert.throws(() => managementRequest({ method: 'GET', path }))
  for (const name of ['Authorization', 'Cookie', 'Host', 'Origin', 'X-Forwarded-Host'])
    assert.throws(() => managementRequest({ method: 'GET', path: '/capabilities', headers: { [name]: 'value' } }))
  assert.throws(() =>
    managementRequest({ method: 'POST', path: '/operations', headers: { 'Idempotency-Key': 'a\r\nb' } }),
  )
  assert.throws(() => managementRequest({ method: 'GET', path: '/capabilities', body: {} }))
  assert.throws(() => managementRequest({ method: 'POST', path: '/operations', body: 'a'.repeat(2 * 1024 * 1024) }))
})

test('persistent host identity initializes atomically and survives project change and reload', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-server-profile-'))
  try {
    const profiles = await Promise.all(Array.from({ length: 8 }, () => loadLocalServerProfile(root)))
    assert.equal(new Set(profiles.map(p => p.serverId)).size, 1)
    const id = profiles[0].serverId
    await saveLocalServerProject(root, join(root, 'project-a'), false)
    assert.deepEqual(await loadLocalServerProfile(root), {
      schemaVersion: 1,
      serverId: id,
      projectDirectory: join(root, 'project-a'),
      builtinOnly: false,
    })
    await saveLocalServerProject(root, join(root, 'project-b'), true)
    assert.equal((await loadLocalServerProfile(root)).serverId, id)
    const raw = await readFile(join(root, 'server.json'), 'utf8')
    assert.doesNotMatch(raw, /bootId|port|running/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('corrupt host identity never silently becomes a different server', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-server-profile-corrupt-'))
  try {
    await writeFile(join(root, 'server.json'), '{broken')
    await assert.rejects(loadLocalServerProfile(root))
    assert.equal(await readFile(join(root, 'server.json'), 'utf8'), '{broken')
    await writeFile(join(root, 'server.json'), JSON.stringify({ schemaVersion: 99, serverId: 'unknown' }))
    await assert.rejects(loadLocalServerProfile(root))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
