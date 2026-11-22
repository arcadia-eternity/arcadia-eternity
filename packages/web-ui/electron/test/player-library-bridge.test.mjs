import assert from 'node:assert/strict'
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import { desktopCommand } from '../../../content-dev/src/desktop-cli.ts'
import { playerLibraryHttpHandler, playerLibraryRequest, registerPlayerLibrary } from '../player-library-bridge.mjs'
import { startTestPlayerLibraryBridge } from './fixtures/player-library-bridge.mjs'

const label = 'Arcadia',
  key = 'a'.repeat(64)
async function request(handler, input, fields = {}) {
  const { headers, remoteAddress = '127.0.0.1', url = '/v1/player-library', method = 'POST' } = fields
  const req = Object.assign(Readable.from([Buffer.from(input)]), {
    socket: { remoteAddress, localPort: 39481 },
    url,
    method,
    headers: {
      host: '127.0.0.1:39481',
      authorization: 'Bearer ' + key,
      'content-type': 'application/json',
      ...headers,
    },
  })
  const res = {
    writeHead(status) {
      this.status = status
    },
    end(body) {
      this.body = JSON.parse(body)
    },
  }
  await handler(req, res)
  return res
}

test('local desktop authenticates before dispatch and rejects browser requests, remote peers and oversized bodies', async () => {
  const calls = []
  const handler = playerLibraryHttpHandler({
    token: key,
    dispatch: async input => {
      calls.push(input)
      return { id: 'target' }
    },
  })
  const body = JSON.stringify({ operation: 'describe' })
  for (const fields of [
    { headers: { authorization: undefined } },
    { headers: { authorization: 'Bearer ' + 'f'.repeat(64) } },
    { headers: { origin: 'null' } },
    { headers: { 'sec-fetch-site': 'same-origin' } },
    { headers: { host: 'example.org:39481' } },
    { remoteAddress: '192.0.2.3' },
  ])
    assert.equal((await request(handler, body, fields)).status, 403)
  for (const fields of [{ method: 'GET' }, { url: '/admin' }, { headers: { 'content-type': 'text/plain' } }])
    assert.equal((await request(handler, body, fields)).status, 400)
  assert.equal((await request(handler, ' '.repeat(17000))).body.error.code, 'REQUEST_TOO_LARGE')
  assert.equal((await request(handler, '{bad')).body.error.code, 'INVALID_REQUEST')
  assert.deepEqual(calls, [])
  assert.deepEqual((await request(handler, body)).body, { result: { id: 'target' } })
})

test('owner exposes only list and installs through the personal library and original environment operation', async t => {
  const home = await mkdtemp(join(tmpdir(), 'arcadia-player-request-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const file = join(home, 'candidate.tgz')
  await writeFile(file, 'fixture')
  const calls = []
  const listCalls = []
  const dispatch = playerLibraryRequest({
    id: 'target',
    label,
    library: {
      list: async () => {
        listCalls.push('pack')
        return {
          packages: [{ id: 'p', name: 'one', namespace: 'test', version: '1.0.0', source: { private: 'hidden' } }],
        }
      },
      installNpm: async (...args) => {
        calls.push(args)
        return 'npm-id'
      },
      installFile: async (...args) => {
        calls.push(args)
        return 'file-id'
      },
    },
    environments: {
      snapshot: async () => {
        listCalls.push('environment')
        return {
          selectedEnvironmentId: 'cup',
          environments: [{ document: { id: 'cup', name: 'Cup', secret: 'hidden' } }],
        }
      },
      request: async (input, { chooseRecipeArchive }) => {
        calls.push([input, await chooseRecipeArchive()])
        return { operationId: 'work' }
      },
      waitForOperation: async id => {
        assert.equal(id, 'work')
        return { environmentId: 'new-cup', document: { name: 'Cup' } }
      },
    },
  })
  assert.deepEqual(await dispatch({ operation: 'describe' }), { id: 'target', label })
  assert.deepEqual(await dispatch({ operation: 'list', kind: 'pack' }), {
    packages: [{ id: 'p', name: 'one', namespace: 'test', version: '1.0.0' }],
  })
  assert.deepEqual(listCalls, ['pack'])
  assert.deepEqual(await dispatch({ operation: 'list', kind: 'environment' }), {
    environments: [{ id: 'cup', name: 'Cup', selected: true }],
    selectedEnvironmentId: 'cup',
  })
  assert.deepEqual(listCalls, ['pack', 'environment'])
  assert.deepEqual(await dispatch({ operation: 'install', kind: 'pack', source: { kind: 'npm', spec: 'one@1.0.0' } }), {
    kind: 'pack',
    id: 'npm-id',
  })
  assert.deepEqual(await dispatch({ operation: 'install', kind: 'pack', source: { kind: 'archive', file } }), {
    kind: 'pack',
    id: 'file-id',
  })
  assert.deepEqual(
    await dispatch({
      operation: 'install',
      kind: 'environment',
      environmentId: 'new-cup',
      source: { kind: 'archive', file },
      offline: false,
    }),
    { kind: 'environment', id: 'new-cup', name: 'Cup' },
  )
  const zip = join(home, 'candidate.zip')
  await writeFile(zip, 'fixture')
  assert.deepEqual(await dispatch({ operation: 'install', kind: 'pack', source: { kind: 'archive', file: zip } }), {
    kind: 'pack',
    id: 'file-id',
  })
  await assert.rejects(
    dispatch({ operation: 'install', kind: 'environment', source: { kind: 'archive', file: zip } }),
    { code: 'INVALID_INSTALL_SOURCE' },
  )
  assert.deepEqual(calls, [
    ['one@1.0.0', true],
    [await realpath(file), true],
    [
      { action: 'install-recipe', source: { kind: 'file' }, environmentId: 'new-cup', allowDownload: true },
      await realpath(file),
    ],
    [await realpath(zip), true],
  ])
  for (const input of [
    { operation: 'uninstall' },
    { operation: 'select' },
    { operation: 'install', kind: 'pack', source: { kind: 'npm', spec: 'one@latest' } },
    { operation: 'install', kind: 'environment', source: { kind: 'archive', file: 'relative.tgz' } },
    { operation: 'install', kind: 'pack', source: { kind: 'npm', spec: 'one@1.0.0' }, select: true },
  ])
    await assert.rejects(dispatch(input))
})

test('discovery rejects a symlink or shared owner credential directory before publishing', async t => {
  const home = await mkdtemp(join(tmpdir(), 'arcadia-player-unsafe-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const state = join(home, '.arcadia')
  await mkdir(state)
  const external = join(home, 'outside')
  await mkdir(external)
  const dir = join(state, 'player-libraries')
  await symlink(external, dir, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(registerPlayerLibrary({ home, profile: home, label, port: 39481 }), {
    code: 'PLAYER_LIBRARY_DISCOVERY_UNSAFE',
  })
  assert.deepEqual(await readdir(external), [])
  if (process.getuid) {
    await rm(dir)
    await mkdir(dir)
    await chmod(dir, 0o755)
    await assert.rejects(registerPlayerLibrary({ home, profile: home, label, port: 39481 }), {
      code: 'PLAYER_LIBRARY_DISCOVERY_UNSAFE',
    })
  }
})

test('existing resource listener registration retires its credential without closing the shared server', async t => {
  const home = await mkdtemp(join(tmpdir(), 'arcadia-player-registration-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const registration = await registerPlayerLibrary({ home, profile: home, label, port: 39481 })
  const dir = join(home, '.arcadia/player-libraries')
  const [filename] = await readdir(dir)
  const descriptor = JSON.parse(await readFile(join(dir, filename), 'utf8'))
  const adminOnly = { headers: { authorization: undefined, 'x-arcadia-management': 'desktop-manager-token' } }
  assert.equal((await request(registration.handle, '{"operation":"describe"}', adminOnly)).status, 403)
  const authenticated = { headers: { authorization: 'Bearer ' + descriptor.token } }
  assert.equal(descriptor.port, 39481)
  assert.equal(
    (await request(registration.handle, '{"operation":"describe"}', authenticated)).body.result.id,
    descriptor.id,
  )
  await registration.close()
  assert.deepEqual(await readdir(dir), [])
  assert.equal(
    (await request(registration.handle, '{"operation":"describe"}', authenticated)).body.error.code,
    'PLAYER_LIBRARY_CLOSED',
  )
})

test('running desktop advertises a private live target and retires it on shutdown', async t => {
  const home = await mkdtemp(join(tmpdir(), 'arcadia-player-live-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  let bridge
  try {
    bridge = await startTestPlayerLibraryBridge({ home, profile: home, label })
  } catch (error) {
    if (!process.env.GITHUB_ACTIONS && error.code === 'EPERM' && error.syscall === 'listen')
      return t.skip('Runner prohibits loopback listeners')
    throw error
  }
  try {
    const dir = join(home, '.arcadia/player-libraries')
    const [name] = await readdir(dir)
    assert.match(name, /^[0-9a-f]{32}\.json$/)
    const file = join(dir, name)
    if (process.getuid) assert.equal((await lstat(file)).mode & 0o777, 0o600)
    const descriptor = JSON.parse(await readFile(file, 'utf8'))
    const url = 'http://127.0.0.1:' + descriptor.port + '/v1/player-library'
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + descriptor.token, 'Content-Type': 'application/json' },
      body: '{"operation":"describe"}',
    })
    assert.deepEqual(await res.json(), { result: { id: descriptor.id, label } })
    assert.equal((await fetch(url, { method: 'POST' })).status, 403)
    const secondProfile = join(home, 'second')
    await mkdir(secondProfile)
    const calls = []
    const second = await startTestPlayerLibraryBridge({
      home,
      profile: secondProfile,
      label: 'Second profile',
      library: {
        installNpm: async (spec, offline) => {
          calls.push([spec, offline])
          return 'installed'
        },
      },
    })
    try {
      const options = { directory: dir }
      const targets = await desktopCommand(['instances'], options)
      assert.equal(targets.instances.length, 2)
      const secondId = targets.instances.find(item => item.label === 'Second profile').id
      await assert.rejects(desktopCommand(['packages', 'install', 'one@1.0.0'], options), /Multiple desktop instances/)
      assert.deepEqual(calls, [])
      const result = await desktopCommand(['packages', 'install', 'one@1.0.0', '--instance', secondId], options)
      assert.ok(JSON.stringify(result).includes('installed'))
      assert.deepEqual(calls, [['one@1.0.0', true]])
    } finally {
      await second.close()
    }
  } finally {
    await bridge.close()
  }
  assert.deepEqual(await readdir(join(home, '.arcadia/player-libraries')), [])
})
