import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AuthorWorkspace } from '../src/workspace.mjs'
import { inspectAsset, imageByteLimit } from '../src/asset-inspect.mjs'

async function fixture(t, records) {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-asset-inspect-'))
  await mkdir(join(root, 'data/resources'), { recursive: true })
  await mkdir(join(root, 'assets'))
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: 'media', arcadia: { projectId: 'media', namespace: 'media' } }),
  )
  await writeFile(join(root, 'data/resources/images.json'), JSON.stringify(records))
  const workspace = await AuthorWorkspace.open(root, { watch: false })
  t.after(async () => {
    await workspace.close()
    await rm(root, { recursive: true, force: true })
  })
  return { root, workspace }
}
const image = { id: 'icon', kind: 'image', source: 'assets/icon.bin' }

test('local declared images expose actual metadata and optional bounded native MCP content', async t => {
  const { root, workspace } = await fixture(t, [image])
  const png = await readFile(new URL('../template/assets/marks/slow.png', import.meta.url))
  await writeFile(join(root, image.source), png)
  const before = await workspace.revision()
  const metadata = await inspectAsset(workspace, { id: 'icon' })
  assert.equal(metadata.image, undefined)
  assert.equal(metadata.metadata.mimeType, 'image/png')
  assert.equal(metadata.metadata.width, png.readUInt32BE(16))
  assert.equal(metadata.metadata.height, png.readUInt32BE(20))
  const result = await inspectAsset(workspace, { id: 'icon', includeImage: true })
  assert.equal(result.image.type, 'image')
  assert.equal(result.image.mimeType, 'image/png')
  assert.deepEqual(Buffer.from(result.image.data, 'base64'), png)
  assert.match(result.metadata.version, /^[a-f0-9]{64}$/)
  assert.equal(await workspace.revision(), before)
})

test('inspection refuses undeclared IDs, ambiguous resources, invalid bytes and paths', async t => {
  const { root, workspace } = await fixture(t, [image, { id: 'outside', kind: 'image', source: '../outside.png' }])
  await writeFile(join(root, image.source), 'not a picture')
  await assert.rejects(inspectAsset(workspace, { id: 'missing' }), { code: 'RESOURCE_UNKNOWN' })
  await assert.rejects(inspectAsset(workspace, { id: 'assets/icon.bin' }), { code: 'RESOURCE_INVALID' })
  await assert.rejects(inspectAsset(workspace, { id: 'icon' }), { code: 'RESOURCE_IMAGE_INVALID' })
  await assert.rejects(inspectAsset(workspace, { id: 'outside' }), { code: 'PATH_INVALID' })
  await writeFile(join(root, 'data/resources/duplicate.json'), JSON.stringify(image))
  await assert.rejects(inspectAsset(workspace, { id: 'icon' }), { code: 'RESOURCE_AMBIGUOUS' })
  await rm(join(root, 'data/resources/duplicate.json'))
  await rm(join(root, image.source))
  await symlink(join(root, 'package.json'), join(root, image.source))
  await assert.rejects(inspectAsset(workspace, { id: 'icon' }), { code: 'PATH_INVALID' })
})

test('remote resources remain URLs and audio/SWF are inspected without execution', async t => {
  const records = [
    { id: 'remote', kind: 'image', source: 'https://invalid.example/portrait.png' },
    { id: 'audio', kind: 'audio', source: 'assets/audio.mp3' },
    { id: 'swf', kind: 'swf', source: 'assets/animation.swf' },
  ]
  const { root, workspace } = await fixture(t, records)
  await writeFile(join(root, records[1].source), Buffer.from('ID3\0metadata'))
  await writeFile(join(root, records[2].source), Buffer.from('CWS\0metadata'))
  const originalFetch = globalThis.fetch
  globalThis.fetch = () => assert.fail('remote inspection must not fetch')
  try {
    const remote = await inspectAsset(workspace, { id: 'remote', includeImage: true })
    assert.equal(remote.metadata.reason, 'REMOTE_NOT_FETCHED')
    assert.equal(remote.image, undefined)
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.equal((await inspectAsset(workspace, { id: 'audio' })).metadata.mimeType, 'audio/mpeg')
  assert.equal((await inspectAsset(workspace, { id: 'swf' })).metadata.mimeType, 'application/x-shockwave-flash')
  await assert.rejects(inspectAsset(workspace, { id: 'swf', includeImage: true }), { code: 'NOT_IMAGE' })
})

test('size and dimension limits keep metadata available and incomplete images cannot be embedded', async t => {
  const { root, workspace } = await fixture(t, [image])
  const png = await readFile(new URL('../template/assets/marks/slow.png', import.meta.url))
  const large = Buffer.alloc(imageByteLimit + 1)
  png.copy(large)
  await writeFile(join(root, image.source), large)
  assert.equal((await inspectAsset(workspace, { id: 'icon' })).metadata.reason, 'IMAGE_TOO_LARGE')
  await assert.rejects(inspectAsset(workspace, { id: 'icon', includeImage: true }), { code: 'IMAGE_TOO_LARGE' })
  const dimensions = Buffer.from(png)
  dimensions.writeUInt32BE(10000, 16)
  await writeFile(join(root, image.source), dimensions)
  assert.equal((await inspectAsset(workspace, { id: 'icon' })).metadata.reason, 'IMAGE_DIMENSIONS_EXCEEDED')
  await assert.rejects(inspectAsset(workspace, { id: 'icon', includeImage: true }), {
    code: 'IMAGE_DIMENSIONS_EXCEEDED',
  })
  await writeFile(join(root, image.source), png.subarray(0, png.length - 12))
  await assert.rejects(inspectAsset(workspace, { id: 'icon', includeImage: true }), { code: 'RESOURCE_IMAGE_INVALID' })
})
