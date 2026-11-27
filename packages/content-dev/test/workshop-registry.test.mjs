import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Header } from 'tar'
import { gzipSync } from 'node:zlib'
import {
  canonicalJson,
  generateSigningKey,
  importSigningKey,
  parseEnvelope,
  sha256Hex,
  signEnvelope,
  verifyThreshold,
} from '@arcadia-eternity/pack-loader/workshop'
import {
  buildRegistrySite,
  checkRegistrySource,
  loadRegistrySource,
  npmRegistry,
  purl,
  verifyNpmRelease,
} from '../src/workshop-registry.ts'

const now = Date.parse('2026-11-26T00:00:00.000Z')
const day = 86_400_000
const commit = 'c'.repeat(40)
const signal = new AbortController().signal

function tarball(manifest) {
  const entries = [['package/package.json', Buffer.from(JSON.stringify(manifest))]]
  const blocks = []
  for (const [path, bytes] of entries) {
    const block = Buffer.alloc(512)
    new Header({ path, size: bytes.length, mode: 0o644, type: 'File' }).encode(block)
    blocks.push(block, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512))
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]))
}

class FakeNpm {
  keys = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  packuments = new Map()
  tarballs = new Map()
  attestationsByVersion = new Map()
  verified = []
  rejectBundles = false

  registryKeys() {
    const key = this.keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
    return Promise.resolve([{ keyid: 'SHA256:test', key, expires: null }])
  }
  publish(
    name,
    version,
    { manifest = {}, repository = 'demo/pets', builtFrom = repository, subject, sign: signed = true } = {},
  ) {
    const full = {
      name,
      version,
      repository: { type: 'git', url: `git+https://github.com/${repository}.git` },
      arcadia: { id: 'demo' },
      ...manifest,
    }
    const archive = tarball(full)
    const integrity = 'sha512-' + createHash('sha512').update(archive).digest('base64')
    const url = `https://registry.npmjs.org/${name}/-/${name.split('/').pop()}-${version}.tgz`
    const signature = sign('sha256', Buffer.from(`${name}@${version}:${integrity}`), this.keys.privateKey).toString(
      'base64',
    )
    const packument = this.packuments.get(name) ?? { name, versions: {}, time: {} }
    packument.versions[version] = {
      name,
      version,
      dist: { integrity, tarball: url, ...(signed && { signatures: [{ keyid: 'SHA256:test', sig: signature }] }) },
    }
    packument.time[version] = new Date(now - day).toISOString()
    this.packuments.set(name, packument)
    this.tarballs.set(url, archive)
    const statement = {
      subject: [
        subject ?? {
          name: purl(name, version),
          digest: { sha512: createHash('sha512').update(archive).digest('hex') },
        },
      ],
      predicate: {
        buildDefinition: {
          externalParameters: {
            workflow: {
              repository: `https://github.com/${builtFrom}`,
              path: '.github/workflows/release.yml',
              ref: 'refs/heads/main',
            },
          },
          resolvedDependencies: [{ digest: { gitCommit: commit } }],
        },
      },
    }
    this.attestationsByVersion.set(`${name}@${version}`, [
      {
        predicateType: 'https://slsa.dev/provenance/v1',
        bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify(statement)).toString('base64') } },
      },
    ])
    return { archive, integrity }
  }
  packument(name) {
    return Promise.resolve(structuredClone(this.packuments.get(name) ?? null))
  }
  attestations(name, version) {
    return Promise.resolve(this.attestationsByVersion.get(`${name}@${version}`) ?? [])
  }
  tarball(url) {
    return Promise.resolve(this.tarballs.get(url))
  }
  verifyBundle(_bundle, policy) {
    this.verified.push(policy)
    return this.rejectBundles ? Promise.reject(new Error('certificate mismatch')) : Promise.resolve()
  }
}

const project = (overrides = {}) => ({
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
  releases: [],
  ...overrides,
})

async function rejects(promise, code) {
  await assert.rejects(promise, error => error.code === code || assert.fail(`${error.code}: ${error.message}`))
}

test('verifies an npm release and binds provenance to the declared repository', async () => {
  const npm = new FakeNpm()
  const { integrity, archive } = npm.publish('@demo/pets', '1.0.0', {
    manifest: { dependencies: { '@demo/base': '^1.0.0' } },
  })
  const release = await verifyNpmRelease(project(), await npm.packument('@demo/pets'), '1.0.0', npm, signal)
  assert.equal(release.integrity, integrity)
  assert.equal(release.size, archive.length)
  assert.deepEqual(release.dependencies, { '@demo/base': '^1.0.0' })
  assert.deepEqual(release.provenance, {
    repository: 'demo/pets',
    workflow: '.github/workflows/release.yml@refs/heads/main',
    commit,
  })
  assert.deepEqual(npm.verified, [{ repository: 'demo/pets', commit }])
})

test('rejects releases that break the registry rules', async () => {
  const cases = [
    ['unsigned', { sign: false }, 'WORKSHOP_NPM_SIGNATURE'],
    ['other repository', { builtFrom: 'evil/pets' }, 'WORKSHOP_PROVENANCE_REPOSITORY'],
    ['package.json repository', { repository: 'evil/pets', builtFrom: 'demo/pets' }, 'WORKSHOP_REPOSITORY_MISMATCH'],
    [
      'subject',
      { subject: { name: purl('@demo/pets', '1.0.0'), digest: { sha512: '00' } } },
      'WORKSHOP_PROVENANCE_SUBJECT',
    ],
    ['install script', { manifest: { scripts: { postinstall: 'curl x' } } }, 'WORKSHOP_LIFECYCLE_SCRIPT'],
    ['source effects', { manifest: { arcadia: { effects: 'src/effects.ts' } } }, 'WORKSHOP_EFFECT_ARTIFACT_REQUIRED'],
    ['kind', { manifest: { arcadia: undefined, arcadiaEnvironment: {} } }, 'WORKSHOP_KIND_MISMATCH'],
    ['dependency', { manifest: { dependencies: { x: 'github:evil/x' } } }, 'WORKSHOP_RELEASE_INVALID'],
  ]
  for (const [label, options, code] of cases) {
    const npm = new FakeNpm()
    npm.publish('@demo/pets', '1.0.0', options)
    await rejects(verifyNpmRelease(project(), await npm.packument('@demo/pets'), '1.0.0', npm, signal), code).catch(
      error => assert.fail(`${label}: ${error.message}`),
    )
  }
})

test('rejects tampered archives, missing provenance and failed certificate checks', async () => {
  const npm = new FakeNpm()
  npm.publish('@demo/pets', '1.0.0')
  const packument = await npm.packument('@demo/pets')
  npm.tarballs.set(packument.versions['1.0.0'].dist.tarball, tarball({ name: '@demo/pets', version: '1.0.0' }))
  await rejects(verifyNpmRelease(project(), packument, '1.0.0', npm, signal), 'SOURCE_INTEGRITY_MISMATCH')

  npm.publish('@demo/pets', '1.0.1')
  npm.attestationsByVersion.delete('@demo/pets@1.0.1')
  await rejects(
    verifyNpmRelease(project(), await npm.packument('@demo/pets'), '1.0.1', npm, signal),
    'WORKSHOP_PROVENANCE_MISSING',
  )

  npm.publish('@demo/pets', '1.0.2')
  npm.rejectBundles = true
  await rejects(
    verifyNpmRelease(project(), await npm.packument('@demo/pets'), '1.0.2', npm, signal),
    'WORKSHOP_PROVENANCE_INVALID',
  )
})

async function registry(t, rootKeys, snapshotKey, declarations = [project()]) {
  const directory = await mkdtemp(join(tmpdir(), 'arcadia-registry-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(join(directory, 'root'))
  await mkdir(join(directory, 'projects'))
  for (const declaration of declarations) {
    const { releases: _releases, official: _official, featured: _featured, ...file } = declaration
    await writeFile(join(directory, 'projects', `${declaration.id}.json`), JSON.stringify(file))
  }
  const root = version => ({
    type: 'root',
    spec: 1,
    registry: 'test',
    version,
    expires: new Date(now + 365 * day).toISOString(),
    keys: Object.fromEntries([...rootKeys, snapshotKey].map(key => [key.keyid, key.publicKey])),
    roles: {
      root: { keyids: rootKeys.map(key => key.keyid), threshold: 1 },
      snapshot: { keyids: [snapshotKey.keyid], threshold: 1 },
    },
    mirrors: ['https://registry.test/'],
  })
  await writeFile(join(directory, 'root', '1.json'), canonicalJson(await signEnvelope(root(1), [rootKeys[0]])))
  return { directory, root }
}
const key = async () => importSigningKey((await generateSigningKey()).pkcs8)

test('builds a signed, content-addressed site and carries verified releases forward', async t => {
  const rootKey = await key()
  const snapshotKey = await key()
  const { directory } = await registry(t, [rootKey], snapshotKey)
  const npm = new FakeNpm()
  npm.publish('@demo/pets', '1.0.0')
  npm.publish('@demo/pets', '1.1.0', { sign: false })
  const source = await loadRegistrySource(directory)
  const output = join(directory, 'site')
  const first = await buildRegistrySite(source, output, { npm, signer: snapshotKey, now })
  assert.equal(first.changed, true)
  assert.deepEqual(
    first.index.projects[0].releases.map(item => item.version),
    ['1.0.0'],
  )
  assert.deepEqual(
    first.diagnostics.map(item => [item.version, item.code]),
    [['1.1.0', 'WORKSHOP_NPM_SIGNATURE']],
  )

  const envelope = parseEnvelope(JSON.parse(await readFile(join(output, 'snapshot.json'), 'utf8')))
  await verifyThreshold(envelope, source.root.keys, source.root.roles.snapshot)
  const indexBytes = await readFile(join(output, envelope.signed.index.path))
  assert.equal(sha256Hex(indexBytes), envelope.signed.index.sha256)
  assert.equal(envelope.signed.version, 1)

  const previous = { snapshot: first.snapshot, envelope, index: first.index, indexBytes }
  const calls = npm.verified.length
  const same = await buildRegistrySite(source, join(directory, 'site2'), {
    npm,
    signer: snapshotKey,
    previous,
    now: now + day,
  })
  assert.equal(same.changed, false)
  assert.equal(npm.verified.length, calls, 'carried releases are not reverified')

  npm.publish('@demo/pets', '1.2.0')
  const next = await buildRegistrySite(source, join(directory, 'site3'), {
    npm,
    signer: snapshotKey,
    previous,
    now: now + day,
  })
  assert.equal(next.changed, true)
  assert.equal(next.snapshot.version, 2)
  assert.deepEqual(
    next.index.projects[0].releases.map(item => item.version),
    ['1.2.0', '1.0.0'],
  )
  await readFile(join(directory, 'site3', first.snapshot.index.path))

  const renew = await buildRegistrySite(source, join(directory, 'site4'), {
    npm,
    signer: snapshotKey,
    previous: { ...previous, index: next.index, snapshot: next.snapshot },
    now: Date.parse(next.snapshot.expires) - day,
  })
  assert.equal(renew.changed, true, 'an unchanged index is re-signed before it expires')
  assert.equal(renew.snapshot.index.sha256, next.snapshot.index.sha256)

  await rejects(
    buildRegistrySite(source, join(directory, 'x'), { npm, signer: rootKey, now }),
    'WORKSHOP_SIGNER_UNTRUSTED',
  )
})

test('a changed repository declaration drops carried releases and reverifies them', async t => {
  const rootKey = await key()
  const snapshotKey = await key()
  const { directory } = await registry(t, [rootKey], snapshotKey)
  const npm = new FakeNpm()
  npm.publish('@demo/pets', '1.0.0')
  const source = await loadRegistrySource(directory)
  const first = await buildRegistrySite(source, join(directory, 'a'), { npm, signer: snapshotKey, now })
  const previous = { snapshot: first.snapshot, index: first.index, indexBytes: new Uint8Array() }
  const moved = { ...source, projects: [{ ...source.projects[0], repository: 'other/pets' }] }
  const result = await buildRegistrySite(moved, join(directory, 'b'), { npm, signer: snapshotKey, previous, now })
  assert.deepEqual(result.index.projects[0].releases, [])
  assert.equal(result.diagnostics[0].code, 'WORKSHOP_PROVENANCE_REPOSITORY')
})

test('loads only a valid root chain and well-formed declarations', async t => {
  const rootKey = await key()
  const nextKey = await key()
  const snapshotKey = await key()
  const { directory, root } = await registry(t, [rootKey], snapshotKey)
  const rotated = {
    ...root(2),
    keys: { [nextKey.keyid]: nextKey.publicKey, [snapshotKey.keyid]: snapshotKey.publicKey },
  }
  rotated.roles = { ...rotated.roles, root: { keyids: [nextKey.keyid], threshold: 1 } }
  await writeFile(join(directory, 'root', '2.json'), canonicalJson(await signEnvelope(rotated, [nextKey])))
  await rejects(loadRegistrySource(directory), 'WORKSHOP_SIGNATURE_THRESHOLD')
  await writeFile(join(directory, 'root', '2.json'), canonicalJson(await signEnvelope(rotated, [rootKey, nextKey])))
  assert.equal((await loadRegistrySource(directory)).root.version, 2)

  await writeFile(join(directory, 'root', '4.json'), '{}')
  await rejects(loadRegistrySource(directory), 'WORKSHOP_ROOT_CHAIN')
  await rm(join(directory, 'root', '4.json'))

  await writeFile(
    join(directory, 'projects', 'x.json'),
    JSON.stringify({ ...project({ id: 'x-y-z' }), releases: undefined }),
  )
  await rejects(loadRegistrySource(directory), 'WORKSHOP_DECLARATION_INVALID')
  await writeFile(join(directory, 'projects', 'x.json'), JSON.stringify({ id: 'x', official: true }))
  await rejects(loadRegistrySource(directory), 'WORKSHOP_DECLARATION_INVALID')
  await rm(join(directory, 'projects', 'x.json'))
  const { releases: _r, ...duplicate } = project({ id: 'other-pets' })
  await writeFile(join(directory, 'projects', 'other-pets.json'), JSON.stringify(duplicate))
  await rejects(loadRegistrySource(directory), 'WORKSHOP_DECLARATION_DUPLICATE')
})

test('pull-request check reports verified versions per project', async t => {
  const rootKey = await key()
  const snapshotKey = await key()
  const { directory } = await registry(t, [rootKey], snapshotKey)
  const npm = new FakeNpm()
  const source = await loadRegistrySource(directory)
  assert.equal((await checkRegistrySource(source, { npm }))[0].diagnostics[0].code, 'WORKSHOP_NPM_MISSING')
  npm.publish('@demo/pets', '1.0.0')
  assert.deepEqual((await checkRegistrySource(source, { npm, projects: ['demo-pets'] }))[0].verified, ['1.0.0'])
  await rejects(checkRegistrySource(source, { npm, projects: ['missing'] }), 'WORKSHOP_PROJECT_UNKNOWN')
})

test(
  'live npm: data-pack-base 5.0.3 passes registry signature and Sigstore provenance',
  { skip: !process.env.ARCADIA_LIVE_NPM },
  async () => {
    const npm = npmRegistry()
    const official = project({
      id: 'official.base',
      npm: '@arcadia-eternity/data-pack-base',
      repository: 'arcadia-eternity/arcadia-eternity',
    })
    const packument = await npm.packument(official.npm, signal)
    const release = await verifyNpmRelease(official, packument, '5.0.3', npm, signal)
    assert.equal(release.provenance.repository, 'arcadia-eternity/arcadia-eternity')
    assert.equal(release.provenance.commit, '0c08ad803665320ba8ed5fc247a112b07756d81e')
    await rejects(
      verifyNpmRelease({ ...official, repository: 'arcadia-eternity/other' }, packument, '5.0.3', npm, signal),
      'WORKSHOP_PROVENANCE_REPOSITORY',
    )
  },
)
