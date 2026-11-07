import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { create, Header } from 'tar'
import { acquireSource } from '../src/managed-sources.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-sources-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const packageRoot = join(root, 'package')
  await mkdir(packageRoot)
  await writeFile(
    join(packageRoot, 'package.json'),
    JSON.stringify({ name: 'source-test', version: '1.0.0', scripts: { prepare: 'touch SHOULD_NOT_EXIST' } }),
  )
  await writeFile(join(packageRoot, 'index.js'), 'throw new Error("author module must never execute")')
  return { root, packageRoot, destination: join(root, 'result') }
}
function tarEntry(path, bytes = Buffer.from('escape')) {
  const header = new Header({ path, size: bytes.length, mode: 0o600, type: 'File' })
  const block = Buffer.alloc(512)
  header.encode(block)
  return Buffer.concat([block, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512), Buffer.alloc(1024)])
}
function zipArchive(entries) {
  const buffers = [],
    directory = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name),
      bytes = Buffer.from(entry.data)
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
    central.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    buffers.push(local, name, bytes)
    directory.push(central, name)
    offset += local.length + name.length + bytes.length
  }
  const directoryBytes = Buffer.concat(directory)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directoryBytes.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...buffers, directoryBytes, end])
}

test('captures a built package without evaluating modules, running scripts or copying host secrets', async t => {
  const { root, packageRoot, destination } = await fixture(t)
  await writeFile(join(packageRoot, '.env.production'), 'TOKEN=private')
  await writeFile(join(packageRoot, '.npmrc'), '//registry/:_authToken=private')
  const result = await acquireSource({ kind: 'directory', directory: packageRoot }, { destination })
  assert.equal(result.provenance.name, 'source-test')
  assert.equal(result.provenance.kind, 'directory')
  assert.equal(
    await readFile(join(result.directory, 'index.js'), 'utf8'),
    'throw new Error("author module must never execute")',
  )
  await assert.rejects(access(join(result.directory, '.env.production')))
  await assert.rejects(access(join(result.directory, '.npmrc')))
  await assert.rejects(access(join(root, 'SHOULD_NOT_EXIST')))
})
test('extracts standard npm tgz and ZIP packages through the same validated result', async t => {
  const { root, packageRoot } = await fixture(t)
  const tgz = join(root, 'source.tgz')
  await create({ cwd: root, file: tgz, gzip: true, portable: true }, ['package'])
  const first = await acquireSource({ kind: 'archive', file: tgz }, { destination: join(root, 'tgz-result') })
  const zip = join(root, 'source.zip')
  await writeFile(
    zip,
    zipArchive([
      { name: 'release/package.json', data: await readFile(join(packageRoot, 'package.json')) },
      { name: 'release/index.js', data: await readFile(join(packageRoot, 'index.js')) },
    ]),
  )
  const second = await acquireSource({ kind: 'archive', file: zip }, { destination: join(root, 'zip-result') })
  assert.equal(
    await readFile(join(first.directory, 'package.json'), 'utf8'),
    await readFile(join(second.directory, 'package.json'), 'utf8'),
  )
})
test('rejects directory and archived symlinks without following targets', async t => {
  const { root, packageRoot } = await fixture(t)
  await writeFile(join(root, 'secret'), 'private')
  await symlink('../secret', join(packageRoot, 'leak'))
  await assert.rejects(
    acquireSource({ kind: 'directory', directory: packageRoot }, { destination: join(root, 'dir-result') }),
    { code: 'SOURCE_LINK_FORBIDDEN' },
  )
  const tgz = join(root, 'linked.tgz')
  await create({ cwd: root, file: tgz, gzip: true }, ['package'])
  await assert.rejects(acquireSource({ kind: 'archive', file: tgz }, { destination: join(root, 'tar-result') }), {
    code: 'SOURCE_LINK_FORBIDDEN',
  })
  const zip = join(root, 'linked.zip')
  await writeFile(zip, zipArchive([{ name: 'package/leak', data: '../secret', mode: 0o120777 }]))
  await assert.rejects(acquireSource({ kind: 'archive', file: zip }, { destination: join(root, 'zip-result') }), {
    code: 'SOURCE_LINK_FORBIDDEN',
  })
  assert.equal(await readFile(join(root, 'secret'), 'utf8'), 'private')
})
test('rejects archive traversal, case aliases and path ambiguity with complete staging cleanup', async t => {
  const { root } = await fixture(t)
  const bad = join(root, 'bad.tar')
  await writeFile(bad, tarEntry('../outside'))
  const target = join(root, 'failed')
  await assert.rejects(acquireSource({ kind: 'archive', file: bad }, { destination: target }), {
    code: 'SOURCE_PATH_INVALID',
  })
  await assert.rejects(access(target))
  const zip = join(root, 'aliases.zip')
  await writeFile(
    zip,
    zipArchive([
      { name: 'a', data: 'first' },
      { name: 'A', data: 'second' },
    ]),
  )
  await assert.rejects(acquireSource({ kind: 'archive', file: zip }, { destination: target }), {
    code: 'SOURCE_PATH_DUPLICATE',
  })
})
test('enforces file and byte budgets and handles cancellation before touching destination', async t => {
  const { packageRoot, destination } = await fixture(t)
  await assert.rejects(acquireSource({ kind: 'directory', directory: packageRoot }, { destination, maxFiles: 1 }), {
    code: 'SOURCE_LIMIT',
  })
  await assert.rejects(access(destination))
  await assert.rejects(acquireSource({ kind: 'directory', directory: packageRoot }, { destination, maxBytes: 2 }), {
    code: 'SOURCE_LIMIT',
  })
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    acquireSource({ kind: 'directory', directory: packageRoot }, { destination, signal: controller.signal }),
    { name: 'AbortError' },
  )
  await assert.rejects(access(destination))
})
test('empty archive directories count against entry limits and reserved device paths are rejected', async t => {
  const { root, destination } = await fixture(t)
  const archive = join(root, 'dirs.zip')
  await writeFile(
    archive,
    zipArchive([
      { name: 'one/', data: '', mode: 0o040755 },
      { name: 'two/', data: '', mode: 0o040755 },
    ]),
  )
  await assert.rejects(acquireSource({ kind: 'archive', file: archive }, { destination, maxFiles: 1 }), {
    code: 'SOURCE_LIMIT',
  })
  await writeFile(archive, zipArchive([{ name: 'CON.txt', data: 'forbidden' }]))
  await assert.rejects(acquireSource({ kind: 'archive', file: archive }, { destination }), {
    code: 'SOURCE_PATH_INVALID',
  })
})
test('registered remote sources require HTTPS, no embedded credentials and a complete Git commit', async t => {
  const { root } = await fixture(t)
  for (const [index, source] of [
    { kind: 'url', url: 'http://example.com/package.tgz' },
    { kind: 'url', url: 'https://user:password@example.com/package.tgz' },
    { kind: 'git', url: 'https://example.com/repo.git', commit: 'main' },
    { kind: 'git', url: 'file:///tmp/repo', commit: 'a'.repeat(40) },
  ].entries()) {
    await assert.rejects(acquireSource(source, { destination: join(root, 'source-' + index) }))
  }
})
