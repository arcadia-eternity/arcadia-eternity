import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { createDesktopInstallerWorkspace } from './desktop-installer-artifacts.mjs'

const supported = ['darwin', 'win32', 'linux'].includes(process.platform)
const zipPlatform = ['darwin', 'win32'].includes(process.platform)
const executableRelativePath = process.platform === 'darwin' ? 'Fixture.app/Contents/MacOS/fixture' : 'fixture.exe'
const format = process.platform === 'darwin' ? 'mac-zip' : process.platform === 'win32' ? 'win-zip' : 'appimage'
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

// Small store-only archives let the tests exercise real extraction without
// creating or executing any application or installer binary.
function zipArchive(entries) {
  const locals = [],
    centrals = []
  let offset = 0
  for (const { name: entryName, bytes = Buffer.alloc(0), mode = 0o100755 } of entries) {
    const name = Buffer.from(entryName)
    let crc = 0xffffffff
    for (const byte of bytes) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
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
    central.writeUInt32LE((mode << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    locals.push(local, name, bytes)
    centrals.push(central, name)
    offset += local.length + name.length + bytes.length
  }
  const directory = Buffer.concat(centrals),
    end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

async function fixture(t) {
  const parent = await mkdtemp(join(tmpdir(), 'arcadia-installer-test-'))
  const workspace = await createDesktopInstallerWorkspace({ parentDirectory: parent })
  t.after(async () => {
    await workspace.close()
    await rm(parent, { recursive: true, force: true })
  })
  return { parent, workspace }
}

async function artifact(parent, label, extraEntries = []) {
  const payload = process.platform === 'linux' ? Buffer.alloc(128) : Buffer.from(`fixture ${label}\n`)
  if (process.platform === 'linux') {
    // Only the artifact adapter's copying and executable mode are exercised;
    // this is not a runnable AppImage and is never passed to a process API.
    payload.write('\x7fELF', 0, 'latin1')
    payload[4] = 2
    payload[5] = 1
    payload[6] = 1
    payload.write('AI\x02', 8, 'latin1')
    payload.write(`fixture ${label}`, 32)
  }
  const bytes = zipPlatform ? zipArchive([{ name: executableRelativePath, bytes: payload }, ...extraEntries]) : payload
  const path = join(parent, `${label}.${zipPlatform ? 'zip' : 'AppImage'}`)
  await writeFile(path, bytes)
  return { artifact: path, sha256: digest(bytes), format, ...(zipPlatform ? { executableRelativePath } : {}), payload }
}

function installOptions(source, extra = {}) {
  const { payload: _payload, ...options } = source
  return { ...options, ...extra }
}

test(
  'native artifact replacement keeps one application slot and a separate persistent profile',
  { skip: !supported },
  async t => {
    const { parent, workspace } = await fixture(t)
    const a = await artifact(parent, 'A'),
      b = await artifact(parent, 'B')
    const first = await workspace.install(installOptions(a))
    await writeFile(join(workspace.profileDir, 'state.json'), '{"serverId":"persisted"}\n')
    const second = await workspace.install(installOptions(b))
    assert.equal(second.executable, first.executable)
    assert.equal(second.installedRoot, first.installedRoot)
    assert.equal(second.profileDir, workspace.profileDir)
    assert.equal(second.artifactHash, b.sha256)
    assert.deepEqual(second.argsPrefix, [])
    assert.deepEqual(await readFile(second.executable), b.payload)
    assert.equal(await readFile(join(workspace.profileDir, 'state.json'), 'utf8'), '{"serverId":"persisted"}\n')
    assert.ok(relative(first.installedRoot, workspace.profileDir).startsWith('..'))
    assert.ok((await lstat(first.installedRoot)).isDirectory())
    if (process.platform !== 'win32') assert.ok((await lstat(second.executable)).mode & 0o100)
  },
)

test('source hash mismatch rejects before replacing an installed artifact', { skip: !supported }, async t => {
  const { parent, workspace } = await fixture(t)
  const a = await artifact(parent, 'A'),
    b = await artifact(parent, 'B')
  const first = await workspace.install(installOptions(a))
  let accepted = false
  await assert.rejects(
    workspace.install(
      installOptions(b, {
        sha256: '0'.repeat(64),
        accept: async () => {
          accepted = true
        },
      }),
    ),
  )
  assert.equal(accepted, false)
  assert.deepEqual(await readFile(first.executable), a.payload)
})

test(
  'failed acceptance restores the previous artifact without rolling back the separate profile',
  { skip: !supported },
  async t => {
    const { parent, workspace } = await fixture(t)
    const a = await artifact(parent, 'A'),
      b = await artifact(parent, 'B')
    const first = await workspace.install(installOptions(a))
    await writeFile(join(workspace.profileDir, 'state'), 'keep profile')
    const failure = new Error('candidate acceptance rejected')
    await assert.rejects(
      workspace.install(
        installOptions(b, {
          accept: async candidate => {
            assert.equal(candidate.executable, first.executable)
            assert.deepEqual(await readFile(candidate.executable), b.payload)
            throw failure
          },
        }),
      ),
      error => error === failure,
    )
    assert.deepEqual(await readFile(first.executable), a.payload)
    assert.equal(await readFile(join(workspace.profileDir, 'state'), 'utf8'), 'keep profile')
  },
)

test(
  'retained acceptance failure freezes the candidate, backup, snapshot and separate profile',
  { skip: !supported },
  async t => {
    const parent = await mkdtemp(join(tmpdir(), 'arcadia-installer-retained-'))
    // This fixture contains only dummy files. The deliberately retained
    // workspace must not use close(), whose refusal is part of the contract.
    t.after(() => rm(parent, { recursive: true, force: true }))
    const workspace = await createDesktopInstallerWorkspace({ parentDirectory: parent })
    const a = await artifact(parent, 'A'),
      b = await artifact(parent, 'B'),
      c = await artifact(parent, 'C')
    const first = await workspace.install(installOptions(a))
    const profile = Buffer.from('{"serverId":"keep-on-failure"}\n')
    await writeFile(join(workspace.profileDir, 'state.json'), profile)
    const failure = Object.assign(new Error('candidate process exit is unconfirmed'), {
      preserveInstallerWorkspace: true,
    })
    let retainedEntries
    await assert.rejects(
      workspace.install(
        installOptions(b, {
          accept: async candidate => {
            assert.equal(candidate.executable, first.executable)
            assert.deepEqual(await readFile(candidate.executable), b.payload)
            retainedEntries = (await readdir(workspace.root)).sort()
            throw failure
          },
        }),
      ),
      error => error === failure,
    )
    const backups = retainedEntries.filter(entry => entry.startsWith('backup-'))
    const stages = retainedEntries.filter(entry => entry.startsWith('staging-'))
    assert.equal(backups.length, 1)
    assert.equal(stages.length, 1)
    const retainedBackup = join(workspace.root, backups[0], relative(first.installedRoot, first.executable))
    const retainedSnapshot = join(workspace.root, stages[0], 'artifact')
    assert.deepEqual(await readFile(first.executable), b.payload)
    assert.deepEqual(await readFile(retainedBackup), a.payload)
    assert.equal(digest(await readFile(retainedSnapshot)), b.sha256)
    assert.deepEqual(await readFile(join(workspace.profileDir, 'state.json')), profile)
    assert.deepEqual((await readdir(workspace.root)).sort(), retainedEntries)
    await assert.rejects(workspace.install(installOptions(c)), /retain|preserv/i)
    await assert.rejects(
      workspace.close(),
      error => /retain|preserv/i.test(error.message) && error.message.includes(workspace.root),
    )
    assert.deepEqual((await readdir(workspace.root)).sort(), retainedEntries)
    assert.deepEqual(await readFile(first.executable), b.payload)
    assert.deepEqual(await readFile(retainedBackup), a.payload)
    assert.equal(digest(await readFile(retainedSnapshot)), b.sha256)
    assert.deepEqual(await readFile(join(workspace.profileDir, 'state.json')), profile)
  },
)

test(
  'overlapping installs are rejected while acceptance holds the application slot',
  { skip: !supported, timeout: 30000 },
  async t => {
    const { parent, workspace } = await fixture(t)
    const a = await artifact(parent, 'A'),
      b = await artifact(parent, 'B')
    let enter, release
    const entered = new Promise(resolve => {
      enter = resolve
    })
    const held = new Promise(resolve => {
      release = resolve
    })
    const first = workspace.install(
      installOptions(a, {
        accept: async () => {
          enter()
          await held
        },
      }),
    )
    try {
      await Promise.race([
        entered,
        first.then(() => {
          throw new Error('acceptance did not hold installation')
        }),
      ])
      await assert.rejects(workspace.install(installOptions(b)))
    } finally {
      release()
      await first
    }
  },
)

test('foreign platform artifacts are rejected without invoking acceptance', { skip: !supported }, async t => {
  const { parent, workspace } = await fixture(t)
  const source = await artifact(parent, 'foreign')
  let accepted = false
  await assert.rejects(
    workspace.install(
      installOptions(source, {
        format: process.platform === 'win32' ? 'mac-zip' : 'nsis',
        accept: async () => {
          accepted = true
        },
      }),
    ),
  )
  assert.equal(accepted, false)
})

for (const attack of [
  'parent traversal',
  'absolute path',
  'external symlink',
  'symlink parent',
  'dangling symlink',
  'symlink cycle',
  'case collision',
]) {
  test(
    `ZIP preflight rejects ${attack} before writing outside the application`,
    { skip: !zipPlatform, timeout: 10000 },
    async t => {
      const { parent, workspace } = await fixture(t)
      const outside = join(parent, 'outside')
      await mkdir(outside)
      await writeFile(join(outside, 'keep'), 'external marker')
      const prefix = process.platform === 'darwin' ? 'Fixture.app/Contents/' : ''
      const cases = {
        'parent traversal': [{ name: '../escape', bytes: Buffer.from('outside') }],
        'absolute path': [{ name: '/absolute-escape', bytes: Buffer.from('outside') }],
        'external symlink': [{ name: `${prefix}linked`, mode: 0o120777, bytes: Buffer.from(outside) }],
        'symlink parent': [
          { name: `${prefix}real/keep`, bytes: Buffer.from('inside') },
          { name: `${prefix}linked`, mode: 0o120777, bytes: Buffer.from('real') },
          { name: `${prefix}linked/created`, bytes: Buffer.from('outside') },
        ],
        'dangling symlink': [{ name: `${prefix}linked`, mode: 0o120777, bytes: Buffer.from('missing') }],
        'symlink cycle': [
          { name: `${prefix}first`, mode: 0o120777, bytes: Buffer.from('second') },
          { name: `${prefix}second`, mode: 0o120777, bytes: Buffer.from('first') },
        ],
        'case collision': [{ name: executableRelativePath.toUpperCase(), bytes: Buffer.from('duplicate') }],
      }
      const source = await artifact(parent, `unsafe-${attack}`, cases[attack])
      await assert.rejects(workspace.install(installOptions(source)))
      assert.deepEqual(await readdir(outside), ['keep'])
      assert.equal(await readFile(join(outside, 'keep'), 'utf8'), 'external marker')
    },
  )
}

test(
  'macOS ZIP preserves contained framework symbolic links',
  { skip: process.platform !== 'darwin', timeout: 10000 },
  async t => {
    const { parent, workspace } = await fixture(t)
    const framework = 'Fixture.app/Contents/Frameworks/Fixture.framework'
    const source = await artifact(parent, 'framework', [
      { name: `${framework}/Versions/A/Fixture`, bytes: Buffer.from('framework bytes') },
      { name: `${framework}/Versions/Current`, mode: 0o120777, bytes: Buffer.from('A') },
      { name: `${framework}/Fixture`, mode: 0o120777, bytes: Buffer.from('Versions/Current/Fixture') },
    ])
    const installed = await workspace.install(installOptions(source))
    const link = join(installed.installedRoot, framework, 'Fixture')
    assert.ok((await lstat(link)).isSymbolicLink())
    assert.equal(await readlink(link), 'Versions/Current/Fixture')
    assert.equal(await readFile(link, 'utf8'), 'framework bytes')
  },
)

test(
  'NSIS refuses missing disposable-runner policy before any executable is invoked',
  { skip: process.platform !== 'win32' },
  async t => {
    const { parent, workspace } = await fixture(t)
    const source = await artifact(parent, 'not-an-installer')
    await assert.rejects(
      workspace.install(installOptions(source, { format: 'nsis', nsisPolicy: {} })),
      /disposable GitHub-hosted Windows runners|distinct preview application ID/,
    )
    assert.deepEqual(await readdir(workspace.profileDir), [])
  },
)

test(
  'cleanup refuses a replaced workspace root and leaves the foreign target untouched',
  { skip: !supported },
  async t => {
    const parent = await mkdtemp(join(tmpdir(), 'arcadia-installer-owner-'))
    const workspace = await createDesktopInstallerWorkspace({ parentDirectory: parent })
    const saved = `${workspace.root}.saved`,
      outside = join(parent, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'keep'), 'external marker')
    await rename(workspace.root, saved)
    await symlink(outside, workspace.root, process.platform === 'win32' ? 'junction' : 'dir')
    t.after(async () => {
      await rm(workspace.root, { force: true })
      await rm(parent, { recursive: true, force: true })
    })
    await assert.rejects(workspace.close())
    assert.equal(await readFile(join(outside, 'keep'), 'utf8'), 'external marker')
    assert.ok((await lstat(saved)).isDirectory())
  },
)

test('cleanup removes only its owned workspace and is idempotent', async t => {
  const parent = await mkdtemp(join(tmpdir(), 'arcadia-installer-cleanup-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const workspace = await createDesktopInstallerWorkspace({ parentDirectory: parent })
  await writeFile(join(parent, 'keep'), 'sibling marker')
  await workspace.close()
  await assert.rejects(lstat(workspace.root), { code: 'ENOENT' })
  await workspace.close()
  assert.equal(await readFile(join(parent, 'keep'), 'utf8'), 'sibling marker')
})
