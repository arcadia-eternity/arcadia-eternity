import {
  canonicalJson,
  generateSigningKey,
  importSigningKey,
  sha256Hex,
  signEnvelope,
} from '@arcadia-eternity/pack-loader/workshop'

const day = 86_400_000
const encode = (value: unknown) => new TextEncoder().encode(canonicalJson(value))

/** A signed single-snapshot registry served from memory. */
export async function createWorkshopFixture(
  packages: { npm: string; version: string; integrity: string }[],
  revocations: { npm: string; version: string; reason: string }[] = [],
) {
  const now = Date.now()
  const iso = (ms: number) => new Date(ms).toISOString()
  const base = 'https://workshop.test/'
  const rootKey = await importSigningKey((await generateSigningKey()).pkcs8)
  const snapshotKey = await importSigningKey((await generateSigningKey()).pkcs8)
  const trustedRoot = await signEnvelope(
    {
      type: 'root',
      spec: 1,
      registry: 'official',
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
  const index = encode({
    type: 'index',
    spec: 1,
    registry: 'official',
    generatedAt: iso(now),
    projects: packages.map((pkg, i) => ({
      id: `project-${i}`,
      kind: 'package',
      npm: pkg.npm,
      title: pkg.npm,
      summary: '',
      authors: ['test'],
      repository: 'test/project',
      tags: [],
      official: false,
      featured: false,
      releases: [
        {
          version: pkg.version,
          integrity: pkg.integrity,
          tarball: `https://registry.npmjs.org/${pkg.npm}/-/x-${pkg.version}.tgz`,
          size: 1,
          publishedAt: iso(now - day),
          dependencies: {},
          containsCode: false,
          provenance: { repository: 'test/project', workflow: '.github/workflows/release.yml', commit: 'a'.repeat(40) },
        },
      ],
    })),
    revocations: revocations.map(item => ({ ...item, revokedAt: iso(now) })),
  })
  const sha256 = sha256Hex(index)
  const snapshot = await signEnvelope(
    {
      type: 'snapshot',
      spec: 1,
      registry: 'official',
      version: 1,
      rootVersion: 1,
      expires: iso(now + 7 * day),
      index: { path: `objects/${sha256}.json`, sha256, length: index.length },
    },
    [snapshotKey],
  )
  const files = new Map([
    [base + 'snapshot.json', encode(snapshot)],
    [base + `objects/${sha256}.json`, index],
  ])
  let online = true
  return {
    trustedRoot,
    fetch: async (url: string) => {
      if (!online) throw new Error('offline')
      return files.get(url) ?? null
    },
    setOnline: (value: boolean) => void (online = value),
  }
}
