import { describe, expect, it } from 'vitest'
import {
  WorkshopClient,
  canonicalJson,
  generateSigningKey,
  importSigningKey,
  OFFICIAL_WORKSHOP_ROOT,
  OFFICIAL_WORKSHOP_SITE,
  resolveWorkshopRelease,
  verifyThreshold,
  verifyWorkshopGraph,
  sha256Hex,
  signEnvelope,
  type SignedEnvelope,
  type WorkshopIndex,
  type WorkshopRoot,
  type WorkshopSigningKey,
  type WorkshopSnapshot,
  type WorkshopTrustState,
} from '../workshop'

const now = Date.parse('2026-11-26T00:00:00.000Z')
const day = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString()
const encode = (value: unknown) => new TextEncoder().encode(canonicalJson(value))

async function key(): Promise<WorkshopSigningKey> {
  return importSigningKey((await generateSigningKey()).pkcs8)
}

function index(
  projects: WorkshopIndex['projects'] = [],
  revocations: WorkshopIndex['revocations'] = [],
): WorkshopIndex {
  return { type: 'index', spec: 1, registry: 'test', generatedAt: iso(now), projects, revocations }
}
const project = (version = '1.0.0'): WorkshopIndex['projects'][number] => ({
  id: 'demo-pets',
  kind: 'package',
  npm: '@demo/pets',
  title: 'Pets',
  summary: '',
  authors: ['demo'],
  repository: 'demo/pets',
  tags: [],
  official: false,
  featured: false,
  releases: [
    {
      version,
      integrity: 'sha512-' + 'A'.repeat(86) + '==',
      tarball: 'https://registry.npmjs.org/@demo/pets/-/pets-' + version + '.tgz',
      size: 100,
      publishedAt: iso(now - day),
      dependencies: {},
      containsCode: false,
      provenance: { repository: 'demo/pets', workflow: '.github/workflows/release-pack.yml', commit: 'a'.repeat(40) },
    },
  ],
})

class Registry {
  files = new Map<string, Uint8Array>()
  constructor(readonly base: string) {}
  put(path: string, bytes: Uint8Array) {
    this.files.set(this.base + path, bytes)
  }
}

async function setup() {
  const rootKey = await key()
  const snapshotKey = await key()
  const mirrors = ['https://primary.test/', 'https://mirror.test/']
  const rootFor = (version: number, root: WorkshopSigningKey, snapshot: WorkshopSigningKey): WorkshopRoot => ({
    type: 'root',
    spec: 1,
    registry: 'test',
    version,
    expires: iso(now + 365 * day),
    keys: { [root.keyid]: root.publicKey, [snapshot.keyid]: snapshot.publicKey },
    roles: { root: { keyids: [root.keyid], threshold: 1 }, snapshot: { keyids: [snapshot.keyid], threshold: 1 } },
    mirrors,
  })
  const root1 = await signEnvelope(rootFor(1, rootKey, snapshotKey), [rootKey])
  const primary = new Registry(mirrors[0])
  const mirror = new Registry(mirrors[1])
  let rootVersion = 1
  const publish = async (
    version: number,
    content: WorkshopIndex,
    options: { signer?: WorkshopSigningKey; expires?: number; targets?: Registry[] } = {},
  ) => {
    const bytes = encode(content)
    const sha256 = sha256Hex(bytes)
    const snapshot: WorkshopSnapshot = {
      type: 'snapshot',
      spec: 1,
      registry: 'test',
      version,
      rootVersion,
      expires: iso(options.expires ?? now + 7 * day),
      index: { path: `objects/${sha256}.json`, sha256, length: bytes.length },
    }
    const envelope = await signEnvelope(snapshot, [options.signer ?? snapshotKey])
    for (const target of options.targets ?? [primary, mirror]) {
      target.put(snapshot.index.path, bytes)
      target.put('snapshot.json', encode(envelope))
    }
    return envelope
  }
  const stored = new Map<string, WorkshopTrustState>()
  const store = {
    read: async (registry: string) => structuredClone(stored.get(registry)),
    write: async (registry: string, state: WorkshopTrustState) => void stored.set(registry, structuredClone(state)),
  }
  const failing = new Set<string>()
  const requests: string[] = []
  const fetch = async (url: string, max: number) => {
    requests.push(url)
    if ([...failing].some(base => url.startsWith(base))) throw new Error('offline')
    const bytes = primary.files.get(url) ?? mirror.files.get(url)
    if (!bytes) return null
    if (bytes.length > max) throw new Error('too large')
    return bytes
  }
  let clock = now
  const client = (trustedRoot: SignedEnvelope<unknown> = root1) =>
    new WorkshopClient({ trustedRoot, store, fetch, now: () => clock })
  return {
    rootKey,
    snapshotKey,
    rootFor,
    root1,
    primary,
    mirror,
    publish,
    stored,
    failing,
    requests,
    client,
    fetch,
    setRootVersion: (value: number) => (rootVersion = value),
    advance: (ms: number) => (clock += ms),
  }
}

describe('workshop signed snapshots', () => {
  it('verifies a snapshot, its content-addressed index, and resolves an exact release', async () => {
    const t = await setup()
    await t.publish(1, index([project()]))
    const view = await t.client().refresh()
    expect(view.freshness).toBe('fresh')
    expect(resolveWorkshopRelease(view, '@demo/pets', '1.0.0').release.version).toBe('1.0.0')
    expect(() => resolveWorkshopRelease(view, '@demo/pets', '2.0.0')).toThrow('WORKSHOP_RELEASE_UNKNOWN')
  })

  it('rejects signatures from keys outside the snapshot role, including the root key', async () => {
    const t = await setup()
    await t.publish(1, index(), { signer: t.rootKey })
    await expect(t.client().refresh()).rejects.toMatchObject({ code: 'WORKSHOP_MIRRORS_FAILED' })
    await t.publish(1, index(), { signer: await key() })
    await expect(t.client().refresh()).rejects.toThrow(/WORKSHOP_SIGNATURE_THRESHOLD/)
  })

  it('rejects a tampered index whose digest differs from the signed snapshot', async () => {
    const t = await setup()
    const envelope = await t.publish(1, index([project()]))
    const path = (envelope.signed as WorkshopSnapshot).index.path
    const tampered = encode(index([project('9.9.9')]))
    t.primary.put(path, tampered)
    t.mirror.put(path, tampered)
    await expect(t.client().refresh()).rejects.toThrow(/WORKSHOP_INDEX_DIGEST_MISMATCH/)
  })

  it('rejects rollback to an older snapshot and serves the trusted cache as stale', async () => {
    const t = await setup()
    const old = await t.publish(1, index([project('1.0.0')]))
    const client = t.client()
    await t.publish(2, index([project('2.0.0')]))
    expect((await client.refresh()).snapshot.version).toBe(2)
    for (const target of [t.primary, t.mirror]) target.put('snapshot.json', encode(old))
    const view = await client.refresh()
    expect(view.freshness).toBe('stale')
    expect(view.snapshot.version).toBe(2)
    expect(view.error?.code).toBe('WORKSHOP_MIRRORS_FAILED')
    expect(view.error?.message).toMatch(/WORKSHOP_ROLLBACK/)
    expect(() => resolveWorkshopRelease(view, '@demo/pets', '2.0.0')).toThrow('WORKSHOP_INDEX_STALE')
  })

  it('rejects reuse of a snapshot version for different content', async () => {
    const t = await setup()
    await t.publish(3, index([project('1.0.0')]))
    const client = t.client()
    await client.refresh()
    await t.publish(3, index([project('1.0.1')]))
    const view = await client.refresh()
    expect(view.freshness).toBe('stale')
    expect(view.error?.message).toMatch(/WORKSHOP_ROLLBACK/)
  })

  it('rejects expired snapshots (freeze attacks)', async () => {
    const t = await setup()
    await t.publish(1, index(), { expires: now + day })
    const client = t.client()
    await client.refresh()
    t.advance(2 * day)
    const view = await client.refresh()
    expect(view.freshness).toBe('stale')
    expect(view.error?.message).toMatch(/WORKSHOP_SNAPSHOT_EXPIRED/)
  })

  it('falls back to a mirror when the primary is unreachable or serves invalid data', async () => {
    const t = await setup()
    await t.publish(1, index([project()]))
    t.failing.add('https://primary.test/')
    const view = await t.client().refresh()
    expect(view.freshness).toBe('fresh')
    expect(t.requests.some(url => url.startsWith('https://mirror.test/'))).toBe(true)
    t.failing.clear()
    t.primary.put('snapshot.json', new TextEncoder().encode('{"signed":{},"signatures":[]}'))
    expect((await t.client().refresh()).freshness).toBe('fresh')
  })

  it('serves the verified offline cache when every mirror fails', async () => {
    const t = await setup()
    await t.publish(1, index([project()]))
    await t.client().refresh()
    t.failing.add('https://primary.test/')
    t.failing.add('https://mirror.test/')
    const view = await t.client().refresh()
    expect(view.freshness).toBe('stale')
    expect(view.index.projects[0].npm).toBe('@demo/pets')
    const cached = await t.client().cached()
    expect(cached?.snapshot.version).toBe(1)
  })

  it('rotates the snapshot key through a root update signed by old and new root keys', async () => {
    const t = await setup()
    await t.publish(1, index())
    const client = t.client()
    await client.refresh()
    const nextRoot = await key()
    const nextSnapshot = await key()
    const root2 = t.rootFor(2, nextRoot, nextSnapshot)
    const onlyNew = await signEnvelope(root2, [nextRoot])
    t.primary.put('root/2.json', encode(onlyNew))
    t.mirror.put('root/2.json', encode(onlyNew))
    t.setRootVersion(2)
    await t.publish(2, index([project()]), { signer: nextSnapshot })
    const rejected = await client.refresh()
    expect(rejected.freshness).toBe('stale')
    expect(rejected.error?.message).toMatch(/WORKSHOP_SIGNATURE_THRESHOLD/)
    const both = await signEnvelope(root2, [t.rootKey, nextRoot])
    t.primary.put('root/2.json', encode(both))
    t.mirror.put('root/2.json', encode(both))
    const view = await client.refresh()
    expect(view.freshness).toBe('fresh')
    expect(view.root.version).toBe(2)
    // A compromised former snapshot key can no longer sign under root v2.
    await t.publish(3, index(), { signer: t.snapshotKey })
    expect((await client.refresh()).error?.message).toMatch(/WORKSHOP_SIGNATURE_THRESHOLD/)
  })

  it('refuses revoked releases', async () => {
    const t = await setup()
    await t.publish(
      1,
      index([project()], [{ npm: '@demo/pets', version: '*', reason: 'malware', revokedAt: iso(now) }]),
    )
    const view = await t.client().refresh()
    expect(() => resolveWorkshopRelease(view, '@demo/pets', '1.0.0')).toThrow('malware')
  })

  it('rejects metadata with unknown fields or non-canonical values', async () => {
    const t = await setup()
    await t.publish(1, { ...index(), extra: true } as WorkshopIndex)
    await expect(t.client().refresh()).rejects.toThrow(/WORKSHOP_METADATA_INVALID|WORKSHOP_MIRRORS_FAILED/)
    expect(() => canonicalJson({ value: 1.5 })).toThrow('WORKSHOP_METADATA_INVALID')
  })
})

describe('workshop trust state and graph checks', () => {
  it('keeps a verified root rotation when the new snapshot is not yet available', async () => {
    const t = await setup()
    await t.publish(1, index([project()]))
    const client = t.client()
    await client.refresh()
    const nextRoot = await key()
    const nextSnapshot = await key()
    const root2 = await signEnvelope(t.rootFor(2, nextRoot, nextSnapshot), [t.rootKey, nextRoot])
    t.primary.put('root/2.json', encode(root2))
    t.mirror.put('root/2.json', encode(root2))
    const view = await client.refresh()
    expect(view.freshness).toBe('stale')
    expect(view.snapshot.version).toBe(1)
    const stored = t.stored.get('test')!
    expect((stored.root.signed as WorkshopRoot).version).toBe(2)
    expect((stored.snapshotRoot!.signed as WorkshopRoot).version).toBe(1)
    expect((await t.client().cached())?.snapshot.version).toBe(1)
    // The old snapshot key cannot advance the index once root 2 is trusted.
    await t.publish(2, index(), { signer: t.snapshotKey })
    expect((await client.refresh()).error?.message).toMatch(/WORKSHOP_ROOT_VERSION_MISMATCH|WORKSHOP_SIGNATURE/)
    t.setRootVersion(2)
    await t.publish(2, index([project('2.0.0')]), { signer: nextSnapshot })
    const fresh = await client.refresh()
    expect(fresh.freshness).toBe('fresh')
    expect(t.stored.get('test')!.snapshotRoot).toBeUndefined()
  })

  it('rejects the same snapshot version with a different expiry', async () => {
    const t = await setup()
    await t.publish(1, index([project()]))
    const client = t.client()
    await client.refresh()
    await t.publish(1, index([project()]), { expires: now + 30 * day })
    expect((await client.refresh()).error?.message).toMatch(/WORKSHOP_ROLLBACK/)
  })

  it('does not overwrite newer state saved concurrently by another client', async () => {
    const t = await setup()
    await t.publish(1, index([project('1.0.0')]))
    await t.client().refresh()
    const before = structuredClone(t.stored.get('test'))
    await t.publish(2, index([project('2.0.0')]))
    await t.client().refresh()
    // This client read state before snapshot 2 was saved and still fetches snapshot 1 from a lagging mirror.
    await t.publish(1, index([project('1.0.0')]))
    let reads = 0
    const store = {
      read: async () => (reads++ === 0 ? structuredClone(before) : structuredClone(t.stored.get('test'))),
      write: async (_: string, state: WorkshopTrustState) => void t.stored.set('test', state),
    }
    const view = await new WorkshopClient({ trustedRoot: t.root1, store, fetch: t.fetch, now: () => now }).refresh()
    expect((t.stored.get('test')!.snapshot!.signed as WorkshopSnapshot).version).toBe(2)
    expect(view.snapshot.version).toBe(2)
  })

  it('verifies the integrity of the root package and listed dependencies', async () => {
    const t = await setup()
    const pets = project()
    const base = { ...project('3.0.0'), id: 'demo-base', npm: '@demo/base' }
    base.releases[0].integrity = 'sha512-' + 'B'.repeat(86) + '=='
    await t.publish(1, index([pets, base]))
    const view = await t.client().refresh()
    const target = resolveWorkshopRelease(view, '@demo/pets', '1.0.0')
    const graph = [
      { name: '@demo/pets', version: '1.0.0', integrity: pets.releases[0].integrity },
      { name: '@demo/base', version: '3.0.0', integrity: base.releases[0].integrity },
      { name: 'left-pad', version: '1.3.0', integrity: 'sha512-x' },
    ]
    expect(() => verifyWorkshopGraph(view, target, graph)).not.toThrow()
    expect(() => verifyWorkshopGraph(view, target, [{ ...graph[0], integrity: 'sha512-y' }])).toThrow(
      'WORKSHOP_INTEGRITY_MISMATCH',
    )
    expect(() => verifyWorkshopGraph(view, target, [graph[0], { ...graph[1], integrity: graph[0].integrity }])).toThrow(
      'WORKSHOP_INTEGRITY_MISMATCH',
    )
    expect(() => verifyWorkshopGraph(view, target, [graph[0], { ...graph[1], version: '3.0.1' }])).toThrow(
      'WORKSHOP_RELEASE_UNKNOWN',
    )
    const hostProvided = (item: { name: string }) => item.name === '@demo/base'
    const repacked = [graph[0], { ...graph[1], integrity: 'sha512-local' }]
    expect(() => verifyWorkshopGraph(view, target, repacked, { hostProvided })).not.toThrow()
    expect(() =>
      verifyWorkshopGraph(view, target, [graph[0], { ...repacked[1], version: '3.0.1' }], { hostProvided }),
    ).toThrow('WORKSHOP_RELEASE_UNKNOWN')
    expect(() =>
      verifyWorkshopGraph(view, target, [{ ...graph[0], integrity: 'sha512-local' }], {
        hostProvided: item => item.name === '@demo/pets',
      }),
    ).toThrow('WORKSHOP_INTEGRITY_MISMATCH')
  })

  it('verifies the bundled official root', async () => {
    const root = OFFICIAL_WORKSHOP_ROOT.signed as unknown as WorkshopRoot
    await expect(
      verifyThreshold(
        OFFICIAL_WORKSHOP_ROOT as unknown as SignedEnvelope<{ type: string }>,
        root.keys,
        root.roles.root,
      ),
    ).resolves.toBeUndefined()
    expect(root.mirrors[0]).toBe(OFFICIAL_WORKSHOP_SITE)
  })
})
