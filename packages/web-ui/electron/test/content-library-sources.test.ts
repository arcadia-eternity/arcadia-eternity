import { createHash } from 'node:crypto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { ContentLibrary, readDesktopContentSources } from '../content-library.ts'
import { ManagedProjects } from '../../../content-dev/src/managed-projects.ts'
import { packBuiltProject } from '../../../content-dev/src/pack-project.ts'
import { nativeBuildIdentity } from '@arcadia-eternity/battle/build'
import { inspectNpmProject, prepareNpmProject, resolveNpmInvocation } from '@arcadia-eternity/pack-loader/node'

const exec = promisify(execFile)
const environment = sources => ({
  schemaVersion: 2,
  id: 'shared',
  name: 'Shared',
  packages: {},
  sources,
  rules: { schemaVersion: 1 },
  requires: {},
})

// Store-only ZIP fixture: no platform archive executable is required.
function zipArchive(entries) {
  const localFiles = [],
    centralFiles = []
  let offset = 0
  for (const [path, bytes] of entries) {
    const name = Buffer.from(path)
    let crc = 0xffffffff
    for (const byte of bytes) {
      crc ^= byte
      for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
    crc = (crc ^ 0xffffffff) >>> 0
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(bytes.length, 18)
    local.writeUInt32LE(bytes.length, 22)
    local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50)
    central.writeUInt16LE(0x0314, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(bytes.length, 20)
    central.writeUInt32LE(bytes.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    localFiles.push(local, name, bytes)
    centralFiles.push(central, name)
    offset += local.length + name.length + bytes.length
  }
  const directory = Buffer.concat(centralFiles),
    end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...localFiles, directory, end])
}

async function contentPackage(root, name, version = '1.0.0') {
  const directory = join(root, `source-${name.replaceAll('/', '-').replaceAll('@', '')}-${version}`)
  await mkdir(directory, { recursive: true })
  const namespace = name.split('/').at(-1)
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({
      name,
      version,
      type: 'module',
      license: 'MIT',
      engines: { arcadia: '*' },
      files: ['content.json', 'effect.json'],
      scripts: { prepare: 'exit 99', prepack: 'exit 99', postinstall: 'exit 99' },
      arcadia: {
        formatVersion: 1,
        projectId: namespace,
        namespace,
        content: 'content.json',
        effectArtifact: 'effect.json',
        sdkApi: 4,
      },
    }),
  )
  await writeFile(
    join(directory, 'content.json'),
    JSON.stringify({ data: { skills: [], species: [], marks: [], behaviors: [] } }),
  )
  await writeFile(
    join(directory, 'effect.json'),
    JSON.stringify({
      format: 'arcadia.effect-module',
      version: 1,
      sdkApi: 4,
      packageId: name,
      source:
        'globalThis.__arcadiaLibrarySourceExecuted=true; throw new Error("MUST_NOT_EXECUTE"); export function createEffects(){return []}',
    }),
  )
  const packed = await packBuiltProject(directory, { cache: join(root, 'author-npm-cache') })
  return { name, directory, archive: join(directory, packed.filename) }
}

async function validateProject(directory) {
  const prepared = await prepareNpmProject(
    directory,
    {
      build: nativeBuildIdentity,
      base: { marks: [], skills: [], species: [] },
      templates: [],
    },
    { policy: { profile: 'local-development' } },
    { effectPreparation: 'prebuilt-only' },
  )
  try {
    assert.equal(globalThis.__arcadiaLibrarySourceExecuted, undefined)
    return prepared.installation
  } finally {
    await prepared.dispose()
  }
}

async function fixture(t, options = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'library-source-integration-')))
  const calls = []
  const libraryRoot = join(root, 'library')
  const run = async (args, signal) => {
    calls.push([...args])
    signal?.throwIfAborted()
    if (args[1] === 'validate') {
      const index = args.indexOf('--npm-project')
      return index === -1 ? {} : validateProject(args[index + 1])
    }
    assert.equal(args[1], 'npm')
    const directory = args[3]
    if (args[2] === 'stage') {
      const inputs = args.includes('--package') ? args.slice(args.indexOf('--package') + 1) : []
      const npm = await resolveNpmInvocation([
        'install',
        '--save-exact',
        '--offline',
        '--ignore-scripts',
        '--omit=dev',
        '--no-audit',
        '--no-fund',
        '--cache',
        join(root, 'local-npm-cache'),
        '--',
        ...inputs,
      ])
      await exec(npm.file, npm.args, { cwd: directory, signal })
      await mkdir(join(directory, 'node_modules'), { recursive: true })
      return inspectNpmProject(directory)
    }
    if (args[2] === 'inspect') return inspectNpmProject(directory)
    if (args[2] === 'approve') {
      await inspectNpmProject(directory)
      const value = { format: 'arcadia.npm-admission', version: 2, profile: args[args.indexOf('--profile') + 1] }
      await writeFile(join(directory, 'arcadia-admission.json'), JSON.stringify(value))
      return value
    }
    throw new Error(`Unexpected library command: ${args.join(' ')}`)
  }
  const source = await contentPackage(root, '@sample/registered')
  const host = { status: () => ({ status: 'idle' }), retainedProjectDirectories: async () => [] }
  const projects = []
  const library = new ContentLibrary({
    root: libraryRoot,
    run,
    host,
    sources: await options.sources?.(source, root),
    reviewInstall: options.reviewInstall,
    authorizeEnvironment: options.authorizeEnvironment,
    createManagedProjects: async (directory, input) => {
      const managed = new ManagedProjects(directory, {
        ...input,
        offline: true,
        bundledPackageRoot: options.bundledPackageRoot,
      })
      projects.push(managed)
      if (!options.cancelOnConsume) return managed
      return {
        prepareProject: (document, prepareOptions, consume) =>
          managed.prepareProject(document, prepareOptions, async directory => {
            options.cancelOnConsume.abort()
            return consume(directory)
          }),
        close: () => managed.close(),
      }
    },
  })
  t.after(async () => {
    await library.close()
    for (const managed of projects) await managed.close()
    await rm(root, { recursive: true, force: true })
  })
  return { root, libraryRoot, library, calls, source }
}

const selection = snapshot => ({
  revision: snapshot.revision,
  activeIds: snapshot.activeIds,
  desiredIds: snapshot.desiredIds,
})

for (const kind of ['archive', 'directory', 'zip']) {
  test(
    `registered ${kind} content prepares in the shared library without changing local selection`,
    { timeout: 60000 },
    async t => {
      const f = await fixture(t, {
        sources: source => ({
          [source.name]:
            kind === 'directory'
              ? { kind: 'directory', directory: source.directory }
              : { kind: 'archive', file: kind === 'archive' ? source.archive : join(source.directory, 'source.zip') },
        }),
      })
      if (kind === 'zip')
        await writeFile(
          join(f.source.directory, 'source.zip'),
          zipArchive(
            await Promise.all(
              ['package.json', 'content.json', 'effect.json'].map(async name => [
                name,
                await readFile(join(f.source.directory, name)),
              ]),
            ),
          ),
        )
      if (kind === 'zip') {
        const id = await f.library.installFile(join(f.source.directory, 'source.zip'), true)
        const entry = (await f.library.list()).packages.find(pkg => pkg.id === id)
        assert.equal(entry.name, f.source.name)
        assert.equal(entry.source.label, 'source.zip')
        await f.library.uninstall(id)
      }
      const local = await contentPackage(f.root, '@sample/local')
      await f.library.installFile(local.archive, true)
      const before = selection(await f.library.list())
      const lease = await f.library.prepareEnvironmentProject(environment([f.source.name]), { offline: true })
      try {
        assert.equal(lease.directory, join(f.libraryRoot, 'projects', basename(lease.directory)))
        assert.match(basename(lease.directory), /^content-[a-f0-9]{32}$/)
        assert.equal(lease.directory, await realpath(lease.directory))
        const inspection = await inspectNpmProject(lease.directory)
        assert.deepEqual(
          inspection.packages.filter(pkg => pkg.manifest).map(pkg => pkg.name),
          [f.source.name],
        )
        const lock = JSON.parse(await readFile(join(lease.directory, 'package-lock.json'), 'utf8'))
        assert.equal(lock.lockfileVersion, 3)
        assert.match(lock.packages[`node_modules/${f.source.name}`].resolved, /^file:candidates\//)
        await validateProject(lease.directory)
        assert.deepEqual(selection(await f.library.list()), before)
        await f.library.collectGarbage()
        assert.ok(await readFile(join(lease.directory, 'package.json')))
      } finally {
        await lease.release()
      }
      await f.library.collectGarbage()
      await assert.rejects(readFile(join(lease.directory, 'package.json')), { code: 'ENOENT' })
      assert.deepEqual(selection(await f.library.list()), before)
    },
  )
}

test(
  'an installed source is usable and multiple installed versions require an explicit declaration',
  { timeout: 60000 },
  async t => {
    const f = await fixture(t)
    await f.library.installFile(f.source.archive, true)
    const lease = await f.library.prepareEnvironmentProject(environment([f.source.name]), { offline: true })
    assert.equal(
      (await inspectNpmProject(lease.directory)).packages.find(pkg => pkg.name === f.source.name).version,
      '1.0.0',
    )
    await lease.release()
    const newer = await contentPackage(f.root, f.source.name, '2.0.0')
    await f.library.installFile(newer.archive, true)
    await assert.rejects(f.library.prepareEnvironmentProject(environment([f.source.name]), { offline: true }), {
      code: 'INSTALL_SOURCE_AMBIGUOUS',
    })
    const chosen = await f.library.prepareEnvironmentProject(
      { ...environment([]), packages: { [f.source.name]: '2.0.0' } },
      { offline: true },
    )
    assert.equal(
      (await inspectNpmProject(chosen.directory)).packages.find(pkg => pkg.name === f.source.name).version,
      '2.0.0',
    )
    await chosen.release()
    assert.equal((await f.library.list()).activeIds, undefined)
  },
)

test('desktop uses the launch-time package locations until restart', { timeout: 60000 }, async t => {
  const f = await fixture(t, {
    sources: async (source, root) => {
      const newer = await contentPackage(root, source.name, '2.0.0')
      const file = join(root, 'package-locations.json')
      const sources = { [source.name]: { kind: 'archive', file: newer.archive } }
      await writeFile(file, JSON.stringify(sources))
      assert.deepEqual(readDesktopContentSources(['--content-sources=' + file], root), sources)
      return readDesktopContentSources(['--content-sources', file], root)
    },
  })
  await f.library.installFile(f.source.archive, true)
  const before = selection(await f.library.list())
  const changed = { [f.source.name]: { kind: 'archive', file: f.source.archive } }
  await writeFile(join(f.root, 'package-locations.json'), JSON.stringify(changed))
  await writeFile(join(f.libraryRoot, 'content-sources.json'), JSON.stringify(changed))
  assert.deepEqual(readDesktopContentSources([], f.libraryRoot), changed)
  const lease = await f.library.prepareEnvironmentProject(environment([f.source.name]), { offline: true })
  try {
    const inspection = await inspectNpmProject(lease.directory)
    assert.equal(inspection.packages.find(pkg => pkg.name === f.source.name).version, '2.0.0')
    await validateProject(lease.directory)
    assert.deepEqual(selection(await f.library.list()), before)
  } finally {
    await lease.release()
  }
})

test('cancelled managed acquisition leaves no adoptable project or changed selection', { timeout: 60000 }, async t => {
  const controller = new AbortController()
  const f = await fixture(t, {
    sources: source => ({ [source.name]: { kind: 'archive', file: source.archive } }),
    cancelOnConsume: controller,
  })
  const before = selection(await f.library.list())
  await assert.rejects(
    f.library.prepareEnvironmentProject(environment([f.source.name]), { offline: true, signal: controller.signal }),
    { name: 'AbortError' },
  )
  assert.deepEqual(selection(await f.library.list()), before)
  await f.library.collectGarbage()
  assert.deepEqual(await readdir(join(f.libraryRoot, 'projects')), [])
})

test('environment preparation uses its own persistent manifest and lock', { timeout: 60000 }, async t => {
  const f = await fixture(t, { sources: source => ({ [source.name]: { kind: 'archive', file: source.archive } }) })
  const first = await f.library.prepareEnvironmentProject(environment([f.source.name]), { offline: true })
  try {
    const manifestPath = join(first.directory, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.customEnvironmentField = 'preserved'
    await writeFile(manifestPath, JSON.stringify(manifest))
    const lock = await readFile(join(first.directory, 'package-lock.json'), 'utf8')
    const next = await f.library.prepareEnvironmentProject(
      { ...environment([]), packages: manifest.dependencies },
      { offline: true, projectDirectory: first.directory },
    )
    try {
      assert.equal(
        JSON.parse(await readFile(join(next.directory, 'package.json'), 'utf8')).customEnvironmentField,
        'preserved',
      )
      assert.equal(await readFile(join(next.directory, 'package-lock.json'), 'utf8'), lock)
      assert.equal(
        (await inspectNpmProject(next.directory)).packages.find(pkg => pkg.name === f.source.name).version,
        '1.0.0',
      )
    } finally {
      await next.release()
    }
  } finally {
    await first.release()
  }
})

test(
  'desktop apply uses the bundled base without downloading or requiring a library installation',
  { timeout: 60000 },
  async t => {
    const { fileURLToPath } = await import('node:url')
    const bundledPackageRoot = fileURLToPath(new URL('../../../../packs/base/', import.meta.url))
    const base = JSON.parse(await readFile(join(bundledPackageRoot, 'package.json'), 'utf8'))
    const f = await fixture(t, { bundledPackageRoot })
    const lease = await f.library.prepareEnvironmentProject(
      { ...environment([]), packages: { [base.name]: base.version } },
      { offline: true },
    )
    try {
      const actual = JSON.parse(
        await readFile(join(lease.directory, 'node_modules', base.name, 'package.json'), 'utf8'),
      )
      assert.equal(actual.version, base.version)
      assert.equal(
        f.calls.some(args => args[2] === 'stage'),
        false,
      )
      assert.equal((await f.library.list()).activeIds, undefined)
    } finally {
      await lease.release()
    }
  },
)

test(
  'shared ZIP member and its unpublished dependency survive reuse, library save, and source removal',
  { timeout: 120000 },
  async t => {
    const { ContentWorkspace } = await import('../../../content-dev/src/content-workspace.ts')
    const { LocalEnvironments } = await import('../local-environments.ts')
    const childName = '@sample/helper'
    const f = await fixture(t, {
      sources: source => ({
        [source.name]: { kind: 'archive', file: join(source.directory, 'source.zip') },
        [childName]: { kind: 'directory', directory: join(source.directory, 'helper') },
      }),
    })
    const helper = await contentPackage(f.root, childName)
    await rename(helper.directory, join(f.source.directory, 'helper'))
    const pkg = JSON.parse(await readFile(join(f.source.directory, 'package.json')))
    pkg.dependencies = { [childName]: '1.0.0' }
    await writeFile(
      join(f.source.directory, 'source.zip'),
      zipArchive([
        ['package.json', Buffer.from(JSON.stringify(pkg))],
        ...(await Promise.all(
          ['content.json', 'effect.json'].map(async path => [path, await readFile(join(f.source.directory, path))]),
        )),
      ]),
    )
    const host = await ContentWorkspace.open(join(f.root, 'sender'))
    const recipient = await ContentWorkspace.open(join(f.root, 'recipient'), { retentions: { list: async () => [] } })
    const validate = async ({ directory }) => ({ contentRevision: (await inspectNpmProject(directory)).digest })
    const api = new LocalEnvironments({
      openWorkspace: async () => recipient,
      library: {
        copyMember: f.library.copyMember,
        prepareEnvironmentProject: (...args) => f.library.prepareEnvironmentProject(...args),
        saveEnvironmentMember: (...args) => f.library.saveEnvironmentMember(...args),
      },
      validate,
    })
    try {
      const doc = environment([f.source.name, childName])
      const lease = await f.library.prepareEnvironmentProject(doc, { offline: true })
      try {
        await host.prepareEnvironment(
          { environmentId: doc.id, document: doc, expectedRevision: null, directory: lease.directory },
          validate,
        )
      } finally {
        await lease.release()
      }
      const preview = await host.previewEnvironmentExport(doc.id)
      assert.deepEqual(preview.dependencies, [])
      const bundle = await host.exportEnvironment(doc.id, { revision: preview.revision, locations: [] })
      const full = await host.exportEnvironment(doc.id, 'offline')
      assert.equal(bundle.format, 'arcadia.environment-export/3')
      assert.equal(full.format, 'arcadia.environment-export/2')
      assert.equal(bundle.archives.length, 2)
      assert.ok(!bundle.files.some(file => file.path.endsWith('/effect.json')))
      const tampered = structuredClone(bundle)
      tampered.archives[0].digest = 'invalid'
      await assert.rejects(recipient.importEnvironment(tampered, {}, validate), { code: 'SOURCE_INTEGRITY_MISMATCH' })
      const imported = await recipient.importEnvironment(bundle, {}, validate)
      assert.equal((await f.library.list()).packages.length, 0)
      const member = imported.members.find(member => member.name === f.source.name)
      assert.ok(member.archiveIntegrity)
      const target = await recipient.saveDraft({
        document: { ...environment([]), id: 'target' },
        expectedRevision: null,
      })
      async function run(action, extra = {}) {
        const { operationId } = await api.request({
          action,
          environmentId: doc.id,
          name: member.name,
          integrity: member.archiveIntegrity,
          ...extra,
        })
        const deadline = Date.now() + 30000
        while (Date.now() < deadline) {
          const job = (await api.snapshot()).operations.find(job => job.id === operationId)
          if (job.status === 'succeeded') return job.result
          if (job.status === 'failed') throw Object.assign(new Error(job.error.message), { code: job.error.code })
          await new Promise(resolve => setTimeout(resolve, 40))
        }
        assert.fail('Member transfer timed out')
      }
      const importedDraft = await recipient.getDraft(doc.id)
      await run('apply', {
        copyFrom: doc.id,
        document: { ...importedDraft.document, id: 'clone' },
        expectedRevision: null,
      })
      await run('use-member', { targetId: 'target', expectedRevision: target.revision })
      assert.equal((await f.library.list()).packages.length, 0)
      await run('save-member')
      assert.deepEqual(
        (await f.library.list()).packages.map(item => item.name),
        [member.name],
      )
      await recipient.deleteDraft({ environmentId: doc.id, expectedRevision: imported.draftRevision })
      const clone = await recipient.getInstallation('clone')
      assert.deepEqual(clone.members.map(member => member.name).sort(), [childName, member.name].sort())
      const targetVersion = await recipient.getInstallation('target')
      assert.deepEqual(
        (await inspectNpmProject(targetVersion.directory)).packages.map(pkg => pkg.name).sort(),
        [childName, member.name].sort(),
      )
      await writeFile(
        join(f.source.directory, 'source.zip'),
        zipArchive([
          ['package.json', Buffer.from(JSON.stringify({ ...pkg, description: 'second build' }))],
          ...(await Promise.all(
            ['content.json', 'effect.json'].map(async path => [path, await readFile(join(f.source.directory, path))]),
          )),
        ]),
      )
      const alternative = { ...doc, id: 'alternative' }
      const second = await f.library.prepareEnvironmentProject(alternative, { offline: true })
      try {
        await host.prepareEnvironment(
          { environmentId: alternative.id, document: alternative, expectedRevision: null, directory: second.directory },
          validate,
        )
      } finally {
        await second.release()
      }
      const importedSecond = await recipient.importEnvironment(
        await host.exportEnvironment(alternative.id),
        {},
        validate,
      )
      const changed = importedSecond.members.find(item => item.name === member.name)
      assert.equal(changed.version, member.version)
      assert.notEqual(changed.archiveIntegrity, member.archiveIntegrity)
      await assert.rejects(
        run('use-member', {
          environmentId: alternative.id,
          integrity: changed.archiveIntegrity,
          targetId: 'target',
          expectedRevision: targetVersion.draftRevision,
        }),
        { code: 'ENVIRONMENT_DEPENDENCY_CONFLICT' },
      )
      assert.equal((await recipient.getInstallation('target')).draftRevision, targetVersion.draftRevision)
      const saved = await f.library.prepareEnvironmentProject(
        { ...environment([]), packages: { [member.name]: member.version } },
        { offline: true },
      )
      try {
        assert.deepEqual(
          (await inspectNpmProject(saved.directory)).packages.map(pkg => pkg.name).sort(),
          [childName, member.name].sort(),
        )
      } finally {
        await saved.release()
      }
    } finally {
      await api.close()
      await host.close()
      await recipient.close()
    }
  },
)

test('public release URL uses the library review and requests execution only for the selected environment', async t => {
  const reviews = [],
    approvals = []
  let install = false,
    allow = false
  const f = await fixture(t, {
    reviewInstall: pkg => {
      reviews.push(pkg)
      return install
    },
    authorizeEnvironment: (_doc, effects) => {
      approvals.push(effects.map(pkg => pkg.name))
      return allow
    },
  })
  const bytes = await readFile(f.source.archive)
  const source = {
    kind: 'url',
    url: 'https://github.com/test/content/releases/download/v1.0.0/registered.tgz',
    integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64'),
  }
  t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(String(url), source.url)
    return new Response(bytes)
  })
  await assert.rejects(f.library.installRemote({ ...source, integrity: 'sha512-YmFk' }), /INTEGRITY_MISMATCH/)
  await assert.rejects(f.library.installRemote(source), { name: 'AbortError' })
  assert.equal((await f.library.list()).packages.length, 0)
  assert.equal(reviews[0].name, f.source.name)
  assert.equal(reviews[0].sdkApi, 4)
  install = true
  const id = await f.library.installRemote(source)
  const entry = (await f.library.list()).packages.find(pkg => pkg.id === id)
  assert.equal(entry.source.provenance.integrity, source.integrity)
  assert.equal(await f.library.installFile(f.source.archive, true), id)
  assert.equal(
    f.calls.some(args => args.includes('approve')),
    false,
  )
  const document = { ...environment([]), packages: { [entry.name]: entry.version } }
  await assert.rejects(f.library.prepareEnvironmentProject(document, { offline: true }), /未授权/)
  assert.deepEqual(approvals, [[entry.name]])
  allow = true
  const lease = await f.library.prepareEnvironmentProject(document, { offline: true })
  await validateProject(lease.directory)
  await lease.release()
})
