import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  canonicalJson,
  generateSigningKey,
  importSigningKey,
  sha256Hex,
  signEnvelope,
} from '@arcadia-eternity/pack-loader/workshop'
import { DesktopWorkshop, fileTrustStore } from '../workshop.ts'

const now = Date.parse('2026-11-26T00:00:00.000Z')
const day = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString()
const encode = (value: unknown) => new TextEncoder().encode(canonicalJson(value))
const integrity = (char: string) => 'sha512-' + char.repeat(86) + '=='

let root: string
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'arcadia-workshop-'))
})
after(async () => {
  await rm(root, { recursive: true, force: true })
})

const release = (version: string, value: string) => ({
  version,
  integrity: value,
  tarball: 'https://registry.npmjs.org/x/-/x-' + version + '.tgz',
  size: 1,
  publishedAt: iso(now - day),
  dependencies: {},
  containsCode: false,
  provenance: { repository: 'demo/x', workflow: '.github/workflows/release-pack.yml', commit: 'a'.repeat(40) },
})
const project = (id: string, kind: 'package' | 'environment', npm: string, releases: ReturnType<typeof release>[]) => ({
  id,
  kind,
  npm,
  title: id,
  summary: '',
  authors: ['demo'],
  repository: 'demo/x',
  tags: [],
  official: false,
  featured: false,
  releases,
})

async function registry(revocations: { npm: string; version: string; reason: string; revokedAt: string }[] = []) {
  const rootKey = await importSigningKey((await generateSigningKey()).pkcs8)
  const snapshotKey = await importSigningKey((await generateSigningKey()).pkcs8)
  const files = new Map<string, Uint8Array>()
  const base = 'https://registry.test/'
  const trustedRoot = await signEnvelope(
    {
      type: 'root',
      spec: 1,
      registry: 'test',
      version: 1,
      expires: iso(now + 365 * day),
      keys: { [rootKey.keyid]: rootKey.publicKey, [snapshotKey.keyid]: snapshotKey.publicKey },
      roles: {
        root: { keyids: [rootKey.keyid], threshold: 1 },
        snapshot: { keyids: [snapshotKey.keyid], threshold: 1 },
      },
      mirrors: [base],
    },
    [rootKey],
  )
  const bytes = encode({
    type: 'index',
    spec: 1,
    registry: 'test',
    generatedAt: iso(now),
    projects: [
      project('demo-pets', 'package', '@demo/pets', [release('1.0.0', integrity('A'))]),
      project('demo-base', 'package', '@demo/base', [release('2.0.0', integrity('B'))]),
      project('demo-env', 'environment', '@demo/env', [release('1.0.0', integrity('C'))]),
    ],
    revocations,
  })
  const sha256 = sha256Hex(bytes)
  files.set(base + `objects/${sha256}.json`, bytes)
  files.set(
    base + 'snapshot.json',
    encode(
      await signEnvelope(
        {
          type: 'snapshot',
          spec: 1,
          registry: 'test',
          version: 1,
          rootVersion: 1,
          expires: iso(now + 7 * day),
          index: { path: `objects/${sha256}.json`, sha256, length: bytes.length },
        },
        [snapshotKey],
      ),
    ),
  )
  let online = true
  const fetch = async (url: string) => {
    if (!online) throw new Error('offline')
    return files.get(url) ?? null
  }
  return { trustedRoot, fetch, setOnline: (value: boolean) => void (online = value) }
}

type Graph = { name: string; version: string; integrity?: string }[]
function host(options: { graph?: Graph; recipeIntegrity?: string; lock?: unknown; installed?: Graph[] } = {}) {
  const calls: string[] = []
  return {
    calls,
    host: {
      listPackages: async () => (options.installed ?? []).map((graph, i) => ({ id: 'p' + i, ...graph[0], graph })),
      installPackage: async (spec: string, verify: (graph: Graph) => void) => {
        calls.push(spec)
        verify(options.graph ?? [])
        return 'installed-id'
      },
      installEnvironment: async (
        spec: string,
        environmentId: string | undefined,
        verify: (recipe: { directory: string; integrity?: string }) => Promise<void>,
      ) => {
        calls.push(spec + ' ' + (environmentId ?? ''))
        const directory = await mkdtemp(join(root, 'recipe-'))
        if (options.lock) await writeFile(join(directory, 'package-lock.json'), JSON.stringify(options.lock))
        await verify({ directory, integrity: options.recipeIntegrity })
        return { operationId: 'op' }
      },
    },
  }
}

test('installs a package only when the resolved graph matches the signed index', async () => {
  const r = await registry()
  const good = host({
    graph: [
      { name: '@demo/pets', version: '1.0.0', integrity: integrity('A') },
      { name: '@demo/base', version: '2.0.0', integrity: integrity('B') },
    ],
  })
  const workshop = new DesktopWorkshop({ directory: join(root, 'a'), host: good.host, ...r, now: () => now })
  assert.deepEqual(await workshop.request({ action: 'install', npm: '@demo/pets', version: '1.0.0' }), {
    packageId: 'installed-id',
  })
  assert.deepEqual(good.calls, ['@demo/pets@1.0.0'])

  const tampered = host({
    graph: [
      { name: '@demo/pets', version: '1.0.0', integrity: integrity('A') },
      { name: '@demo/base', version: '2.0.0', integrity: integrity('Z') },
    ],
  })
  const other = new DesktopWorkshop({ directory: join(root, 'b'), host: tampered.host, ...r, now: () => now })
  await assert.rejects(
    other.request({ action: 'install', npm: '@demo/pets', version: '1.0.0' }),
    /WORKSHOP_INTEGRITY_MISMATCH/,
  )
  await assert.rejects(
    other.request({ action: 'install', npm: '@demo/pets', version: '9.9.9' }),
    /WORKSHOP_RELEASE_UNKNOWN/,
  )
  await assert.rejects(
    other.request({ action: 'install', npm: '@demo/pets', version: '1.0.0', environmentId: 'x' }),
    /WORKSHOP_REQUEST_INVALID/,
  )
})

test('checks the environment archive and its locked dependencies', async () => {
  const r = await registry()
  const lock = {
    packages: {
      '': { name: '@demo/env' },
      'node_modules/@demo/base': { version: '2.0.0', integrity: integrity('B') },
      'node_modules/left-pad': { version: '1.3.0', integrity: 'sha512-x' },
    },
  }
  const ok = host({ recipeIntegrity: integrity('C'), lock })
  const workshop = new DesktopWorkshop({ directory: join(root, 'c'), host: ok.host, ...r, now: () => now })
  assert.deepEqual(
    await workshop.request({ action: 'install', npm: '@demo/env', version: '1.0.0', environmentId: 'friends' }),
    { operationId: 'op' },
  )
  assert.deepEqual(ok.calls, ['@demo/env@1.0.0 friends'])
  for (const bad of [
    host({ recipeIntegrity: integrity('D'), lock }),
    host({
      recipeIntegrity: integrity('C'),
      lock: { packages: { 'node_modules/@demo/base': { version: '2.0.0', integrity: integrity('A') } } },
    }),
  ]) {
    const client = new DesktopWorkshop({ directory: join(root, 'd'), host: bad.host, ...r, now: () => now })
    await assert.rejects(client.request({ action: 'install', npm: '@demo/env', version: '1.0.0' }), /MISMATCH/)
  }
})

test('refuses installs from a stale offline index and reports revoked installed packages', async () => {
  const r = await registry([{ npm: '@demo/base', version: '2.0.0', reason: 'malicious', revokedAt: iso(now) }])
  const h = host({
    installed: [
      [
        { name: '@demo/pets', version: '1.0.0' },
        { name: '@demo/base', version: '2.0.0' },
      ],
    ],
  })
  const directory = join(root, 'e')
  const workshop = new DesktopWorkshop({ directory, host: h.host, ...r, now: () => now })
  const fresh = await workshop.request({ action: 'refresh' })
  assert.ok('freshness' in fresh)
  assert.equal(fresh.freshness, 'fresh')
  assert.deepEqual(fresh.revokedInstalled, [
    { packageId: 'p0', name: '@demo/base', version: '2.0.0', reason: 'malicious' },
  ])
  assert.deepEqual(await readdir(directory), ['test.json'])

  r.setOnline(false)
  const restarted = new DesktopWorkshop({ directory, host: h.host, ...r, now: () => now })
  const view = await restarted.request({ action: 'refresh' })
  assert.ok('freshness' in view)
  assert.equal(view.freshness, 'stale')
  assert.equal(view.projects.length, 3)
  await assert.rejects(
    restarted.request({ action: 'install', npm: '@demo/pets', version: '1.0.0' }),
    /WORKSHOP_INDEX_STALE/,
  )
  assert.deepEqual(h.calls, [])
})

test('the trust store writes atomically and rejects unsafe registry ids', async () => {
  const store = fileTrustStore(join(root, 'store'))
  await Promise.all(Array.from({ length: 10 }, (_, i) => store.write('reg-1', { root: { signed: i, signatures: [] } })))
  const saved = JSON.parse(await readFile(join(root, 'store', 'reg-1.json'), 'utf8'))
  assert.equal(saved.root.signed, 9)
  assert.deepEqual(await readdir(join(root, 'store')), ['reg-1.json'])
  await assert.rejects(store.write('../x', { root: { signed: 0, signatures: [] } }), /WORKSHOP_REGISTRY_INVALID/)
  assert.equal(await store.read('missing'), undefined)
})
