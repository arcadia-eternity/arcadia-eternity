import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { Agent, createServer } from 'node:http'
import { duplexPair } from 'node:stream'
import { playerLibraryHttpHandler, playerLibraryRequest } from '../../web-ui/electron/player-library-bridge.ts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { desktopCommand } from '../src/desktop-cli.ts'

async function registry(t) {
  const directory = await mkdtemp(join(tmpdir(), 'arcadia-desktop-instances-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  async function descriptor(label, overrides = {}) {
    const id = randomBytes(16).toString('hex')
    const data = {
      protocol: 'arcadia.player-library/v1',
      id,
      label,
      pid: process.pid,
      port: 42112,
      token: randomBytes(32).toString('hex'),
      ...overrides,
    }
    await writeFile(join(directory, id + '.json'), JSON.stringify(data), { mode: 0o600 })
    return data
  }
  return { directory, descriptor }
}

test('discovers live private instances without publishing credentials and never guesses between profiles', async t => {
  const { directory, descriptor } = await registry(t)
  const a = await descriptor('Main')
  const b = await descriptor('Second')
  await descriptor('Stale')
  await descriptor('Malformed', { port: 0 })
  if (process.platform !== 'win32') {
    const exposed = await descriptor('Exposed')
    await chmod(join(directory, exposed.id + '.json'), 0o644)
  }
  const contacted = new Set()
  const options = {
    directory,
    transport: async (entry, input) => {
      contacted.add(entry.label)
      assert.ok([a.id, b.id].includes(entry.id) || entry.label === 'Stale')
      if (entry.label === 'Stale') throw new Error('ECONNREFUSED')
      assert.equal(entry.token, entry.id === a.id ? a.token : b.token)
      if (input.operation === 'describe')
        return { status: 200, payload: { result: { id: entry.id, label: entry.label } } }
      const kind = entry.id === a.id ? 'pack' : 'environment'
      assert.deepEqual(input, { operation: 'list', kind })
      const result =
        kind === 'pack'
          ? { packages: [{ id: 'pack' }] }
          : {
              environments: [{ id: 'training', selected: true }],
              selectedEnvironmentId: 'training',
            }
      return { status: 200, payload: { result } }
    },
  }
  const { instances } = await desktopCommand(['instances'], options)
  assert.deepEqual([...contacted].sort(), ['Main', 'Second', 'Stale'])
  assert.deepEqual(
    instances.sort((x, y) => x.label.localeCompare(y.label)),
    [a, b].map(({ id, label }) => ({ id, label })),
  )
  await assert.rejects(desktopCommand(['environments', 'list'], options), /Multiple desktop instances/)
  assert.deepEqual(await desktopCommand(['packages', 'list', '--instance', a.id], options), {
    packages: [{ id: 'pack' }],
  })
  assert.deepEqual(await desktopCommand(['environments', 'list', '--instance', b.id], options), {
    environments: [{ id: 'training', selected: true }],
    selectedEnvironmentId: 'training',
  })
  await assert.rejects(desktopCommand(['environments', 'list', '--instance', '0'.repeat(32)], options), /No matching/)
  await assert.rejects(desktopCommand(['packages', 'list', '--instance', '../escape'], options), {
    code: 'DESKTOP_INSTANCE_INVALID',
  })
})

test('routes archive and npm installations through the owner, honors offline defaults and reports cancellation', async t => {
  const { directory, descriptor } = await registry(t)
  const owner = await descriptor('Local')
  const archive = join(directory, 'match.tgz')
  await writeFile(archive, 'fixture')
  const calls = []
  let denied = false
  const options = {
    directory,
    transport: async (_entry, input) => {
      if (input.operation === 'describe')
        return { status: 200, payload: { result: { id: owner.id, label: owner.label } } }
      calls.push(input)
      return denied
        ? { status: 403, payload: { error: { code: 'INSTALL_CANCELLED', message: 'Cancelled in the player' } } }
        : { status: 200, payload: { result: { kind: input.kind, id: 'match' } } }
    },
  }
  assert.deepEqual(await desktopCommand(['environments', 'install', archive, '--id', 'match'], options), {
    kind: 'environment',
    id: 'match',
  })
  assert.deepEqual(calls.pop(), {
    operation: 'install',
    kind: 'environment',
    source: { kind: 'archive', file: archive },
    environmentId: 'match',
    offline: true,
  })
  const legacyArchive = join(directory, 'legacy.zip')
  await writeFile(legacyArchive, 'fixture')
  await desktopCommand(['packages', 'install', legacyArchive], options)
  assert.deepEqual(calls.pop(), {
    operation: 'install',
    kind: 'pack',
    source: { kind: 'archive', file: legacyArchive },
    offline: true,
  })
  await assert.rejects(desktopCommand(['environments', 'install', legacyArchive], options), /\.tgz environment archive/)
  const npmWithArchiveSuffix = '@author/pack@1.0.0+bundle.zip'
  await desktopCommand(['packages', 'install', npmWithArchiveSuffix], options)
  assert.deepEqual(calls.pop().source, { kind: 'npm', spec: npmWithArchiveSuffix })
  denied = true
  await assert.rejects(
    desktopCommand(['packages', 'install', '@author/pack@1.0.2', '--allow-download'], options),
    /INSTALL_CANCELLED/,
  )
  assert.deepEqual(calls.pop(), {
    operation: 'install',
    kind: 'pack',
    source: { kind: 'npm', spec: '@author/pack@1.0.2' },
    offline: false,
  })
  await assert.rejects(desktopCommand(['packages', 'install', '@author/pack@latest'], options))
  await assert.rejects(desktopCommand(['packages', 'install', archive, '--id', 'ignored'], options))
  assert.equal(calls.length, 0)
})

test('the SDK authenticates to the desktop HTTP owner and waits for the installed environment', async t => {
  const { directory, descriptor } = await registry(t)
  const archive = join(directory, 'external.tgz')
  await writeFile(archive, 'fixture')
  const environments = []
  const server = createServer()
  let port
  try {
    await new Promise((ok, fail) => server.once('error', fail).listen(0, '127.0.0.1', ok))
    port = server.address().port
    t.after(() => new Promise(ok => server.close(ok)))
  } catch (error) {
    if (error.code !== 'EPERM' && error.code !== 'EACCES') throw error
    // On restricted runners use the native Node HTTP request and server parsers
    // on a pair of connected streams. Only the operating-system socket is replaced.
    port = 48177
    t.diagnostic('OS loopback bind unavailable; exercising both HTTP endpoints over paired streams')
    t.mock.method(Agent.prototype, 'createConnection', options => {
      assert.equal(options.host, '127.0.0.1')
      assert.equal(Number(options.port), port)
      const [client, peer] = duplexPair()
      for (const endpoint of [client, peer]) {
        endpoint.setTimeout = () => endpoint
        endpoint.setNoDelay = () => endpoint
        endpoint.setKeepAlive = () => endpoint
      }
      peer.remoteAddress = '127.0.0.1'
      peer.localPort = port
      server.emit('connection', peer)
      return client
    })
  }
  const owner = await descriptor('My desktop', { port })
  const dispatch = playerLibraryRequest({
    id: owner.id,
    label: owner.label,
    library: { list: async () => assert.fail('Environment listing must not inspect the package library') },
    environments: {
      snapshot: async () => ({ environments }),
      async request(input, { chooseRecipeArchive }) {
        assert.equal(input.action, 'install-recipe')
        assert.equal(input.allowDownload, false)
        assert.equal(input.environmentId, 'cup')
        assert.equal(await chooseRecipeArchive(), await realpath(archive))
        return { operationId: 'job' }
      },
      async waitForOperation(id) {
        assert.equal(id, 'job')
        const document = { id: 'cup', name: 'Local cup' }
        environments.push({ document })
        return { environmentId: document.id, document }
      },
    },
  })
  server.on('request', playerLibraryHttpHandler({ token: owner.token, dispatch }))
  assert.deepEqual(await desktopCommand(['instances'], { directory }), {
    instances: [{ id: owner.id, label: owner.label }],
  })
  assert.deepEqual(await desktopCommand(['environments', 'install', archive, '--id', 'cup'], { directory }), {
    kind: 'environment',
    id: 'cup',
    name: 'Local cup',
  })
  assert.deepEqual((await desktopCommand(['environments', 'list'], { directory })).environments, [
    { id: 'cup', name: 'Local cup', selected: false },
  ])
})

test('workshop commands read a verified index and install exact releases through the desktop owner', async t => {
  const { directory, descriptor } = await registry(t)
  const owner = await descriptor('Local')
  const workshop = []
  const dispatch = playerLibraryRequest({
    id: owner.id,
    label: owner.label,
    library: { list: async () => ({ packages: [] }) },
    environments: {
      snapshot: async () => ({ environments: [] }),
      async waitForOperation(id) {
        assert.equal(id, 'env-job')
        return { environmentId: 'cup', document: { id: 'cup', name: 'Cup' } }
      },
    },
    workshop: () => ({
      async request(input) {
        workshop.push(input)
        if (input.action === 'registries') return { registries: [{ id: 'official', official: true }] }
        if (input.action === 'view' || input.action === 'refresh')
          return {
            registry: input.registry ?? 'official',
            official: true,
            freshness: input.action === 'refresh' ? 'fresh' : 'stale',
            snapshot: 3,
            expires: '2026-12-01T00:00:00.000Z',
            projects: [
              {
                id: 'demo.cup',
                kind: 'environment',
                npm: '@demo/cup',
                title: 'Cup',
                summary: 'A cup.',
                authors: ['demo'],
                repository: 'demo/cup',
                tags: [],
                official: false,
                featured: false,
                releases: [
                  { version: '1.1.0', containsCode: false },
                  { version: '1.0.0', containsCode: false },
                ],
              },
            ],
            revocations: [
              { npm: '@demo/cup', version: '1.1.0', reason: 'broken', revokedAt: '2026-11-01T00:00:00.000Z' },
            ],
            revokedInstalled: [],
          }
        if (input.npm === '@demo/cup') return { operationId: 'env-job' }
        return { packageId: 'pkg-1' }
      },
    }),
  })
  const options = {
    directory,
    transport: async (_entry, input) => {
      try {
        return { status: 200, payload: { result: await dispatch(input) } }
      } catch (error) {
        return { status: 400, payload: { error: { code: error.code ?? error.message, message: error.message } } }
      }
    },
  }
  assert.deepEqual(await desktopCommand(['workshop', 'registries'], options), {
    registries: [{ id: 'official', official: true }],
  })
  const listed = await desktopCommand(['workshop', 'list', '--refresh'], options)
  assert.equal(listed.freshness, 'fresh')
  assert.deepEqual(listed.projects[0].versions, ['1.0.0'])
  assert.equal(listed.projects[0].containsCode, false)
  assert.deepEqual(workshop.pop(), { action: 'refresh' })
  await desktopCommand(['workshop', 'list', '--registry', 'local-community'], options)
  assert.deepEqual(workshop.pop(), { action: 'view', registry: 'local-community' })
  assert.deepEqual(await desktopCommand(['workshop', 'install', '@demo/cup@1.0.0', '--id', 'cup'], options), {
    kind: 'environment',
    id: 'cup',
    name: 'Cup',
  })
  assert.deepEqual(workshop.pop(), { action: 'install', npm: '@demo/cup', version: '1.0.0', environmentId: 'cup' })
  assert.deepEqual(await desktopCommand(['workshop', 'install', '@demo/pets@2.0.0'], options), {
    kind: 'pack',
    id: 'pkg-1',
  })
  assert.deepEqual(workshop.pop(), { action: 'install', npm: '@demo/pets', version: '2.0.0' })
  workshop.length = 0
  for (const args of [
    ['workshop', 'install'],
    ['workshop', 'install', '@demo/cup@1.0.0', '--refresh'],
    ['workshop', 'install', '@demo/cup@1.0.0', '--id', 'default'],
    ['workshop', 'install', '@demo/cup@1.0.0', '--allow-download'],
    ['workshop', 'list', '--registry', '../x'],
    ['workshop', 'registries', '--refresh'],
    ['workshop', 'add-registry', 'https://example.org/'],
    ['packages', 'list', '--registry', 'official'],
  ])
    await assert.rejects(desktopCommand(args, options), /arcadia-content desktop/)
  await assert.rejects(desktopCommand(['workshop', 'install', 'nameonly'], options), /exact release/)
  // The owner rejects trust changes even from an authenticated local caller.
  for (const action of ['add-registry', 'remove-registry', 'preview-registry'])
    await assert.rejects(dispatch({ operation: 'workshop', action, site: 'https://example.org/' }), {
      message: '不支持的工坊操作',
    })
  assert.equal(workshop.length, 0)
})
