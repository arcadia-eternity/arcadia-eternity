import { describe, expect, it } from 'vitest'
import {
  WorkshopClient,
  canonicalJson,
  generateSigningKey,
  importSigningKey,
  resolveWorkshopRelease,
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
