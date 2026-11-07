import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { ContentLibrary } from '../content-library.mjs'
import { ManagedProjects } from '../../../content-dev/src/managed-projects.mjs'
import { packBuiltProject } from '../../../content-dev/src/pack-project.mjs'
import { nativeBuildIdentity } from '@arcadia-eternity/battle/v4/build'
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
      files: ['content.json', 'effect.json'],
      scripts: { prepare: 'exit 99', prepack: 'exit 99', postinstall: 'exit 99' },
      arcadia: {
        formatVersion: 1,
        projectId: namespace,
        namespace,
        content: 'content.json',
        effectArtifact: 'effect.json',
        sdkApi: 2,
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
      sdkApi: 2,
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
    sources: options.sources?.(source),
    createManagedProjects: async (directory, input) => {
      const managed = new ManagedProjects(directory, { ...input, offline: true })
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
async function settled(library) {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    const value = await library.list()
    if (value.selection.status === 'failed') throw new Error(value.selection.message)
    if (value.selection.status === 'ready') return value
    await delay(25)
  }
  throw new Error('Local selection did not settle')
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
      const local = await contentPackage(f.root, '@sample/local')
      const localId = await f.library.installFile(local.archive, true)
      await f.library.setSelection([localId], true)
      const before = selection(await settled(f.library))
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
  'an installed source name reuses the active project and ambiguous inactive versions are rejected',
  { timeout: 60000 },
  async t => {
    const f = await fixture(t)
    const firstId = await f.library.installFile(f.source.archive, true)
    await f.library.setSelection([firstId], true)
    await settled(f.library)
    const installed = (await f.library.list()).packages[0]
    assert.equal(installed.containsCode, true)
    assert.equal(installed.graph.find(pkg => pkg.name === f.source.name).containsCode, true)
    const active = await f.library.acquireProject()
    const stageCalls = f.calls.filter(args => args[2] === 'stage').length
    const lease = await f.library.prepareEnvironmentProject(environment([f.source.name]), { offline: true })
    assert.equal(lease.directory, active.directory)
    assert.equal(f.calls.filter(args => args[2] === 'stage').length, stageCalls)
    await lease.release()
    await active.release()
    const newer = await contentPackage(f.root, f.source.name, '2.0.0')
    const staged = await f.library.stageFile(newer.archive, true)
    await f.library.confirmInstall(staged.id, true)
    const chosen = await f.library.prepareEnvironmentProject(environment([f.source.name]), { offline: true })
    assert.equal(chosen.directory, active.directory)
    await chosen.release()
    assert.deepEqual((await f.library.list()).activeIds, [firstId])
    await f.library.setSelection([], true)
    await settled(f.library)
    await assert.rejects(f.library.prepareEnvironmentProject(environment([f.source.name]), { offline: true }), {
      code: 'INSTALL_SOURCE_AMBIGUOUS',
    })
    await assert.rejects(f.library.prepareEnvironmentProject(environment(['@sample/missing']), { offline: true }), {
      code: 'INSTALL_SOURCE_NOT_REGISTERED',
    })
  },
)

test(
  'persisted trusted sources override installed names without replacing the active selection',
  { timeout: 60000 },
  async t => {
    const f = await fixture(t)
    const installedId = await f.library.installFile(f.source.archive, true)
    await f.library.setSelection([installedId], true)
    const before = selection(await settled(f.library))
    const newer = await contentPackage(f.root, f.source.name, '2.0.0')
    const file = join(f.root, 'trusted-sources.json')
    const sources = { [f.source.name]: { kind: 'archive', file: newer.archive } }
    await writeFile(file, JSON.stringify(sources))
    assert.deepEqual(await f.library.importSourceRegistry(file), { sourceIds: [f.source.name] })
    assert.deepEqual(JSON.parse(await readFile(join(f.libraryRoot, 'content-sources.json'), 'utf8')), sources)
    const lease = await f.library.prepareEnvironmentProject(environment([f.source.name]), { offline: true })
    try {
      const inspection = await inspectNpmProject(lease.directory)
      assert.equal(inspection.packages.find(pkg => pkg.name === f.source.name).version, '2.0.0')
      await validateProject(lease.directory)
      assert.deepEqual(selection(await f.library.list()), before)
    } finally {
      await lease.release()
    }
  },
)

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
