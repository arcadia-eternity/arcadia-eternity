import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AuthorWorkspace } from '../src/workspace.ts'
import { inspectAsset, imageByteLimit } from '../src/asset-inspect.ts'

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
const image = { id: 'icon', kind: 'image', source: 'assets/icon.png' }

test('local declared images expose actual metadata and optional bounded native MCP content', async t => {
  const { root, workspace } = await fixture(t, [image])
  const png = await readFile(new URL('../template/assets/marks/slow.png', import.meta.url))
  await writeFile(join(root, image.source), png)
  const before = await workspace.revision()
  const metadata = await inspectAsset(workspace, { id: 'icon' })
  assert.equal(metadata.image, undefined)
  assert.equal(metadata.metadata.mimeType, 'image/png')
  assert.equal(metadata.metadata.bytes, png.length)
  assert.equal(metadata.metadata.width, undefined)
  assert.equal(metadata.metadata.height, undefined)
  const result = await inspectAsset(workspace, { id: 'icon', includeImage: true })
  assert.equal(result.image.type, 'image')
  assert.equal(result.image.mimeType, 'image/png')
  assert.deepEqual(Buffer.from(result.image.data, 'base64'), png)
  assert.match(result.metadata.version, /^[a-f0-9]{64}$/)
  assert.equal(await workspace.revision(), before)
})

test('inspection refuses undeclared IDs, ambiguous resources and invalid paths', async t => {
  const { root, workspace } = await fixture(t, [image, { id: 'outside', kind: 'image', source: '../outside.png' }])
  await writeFile(join(root, image.source), 'not a picture')
  await assert.rejects(inspectAsset(workspace, { id: 'missing' }), { code: 'RESOURCE_UNKNOWN' })
  await assert.rejects(inspectAsset(workspace, { id: 'assets/icon.bin' }), { code: 'RESOURCE_INVALID' })
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

test('large images keep metadata available without reading image content', async t => {
  const { root, workspace } = await fixture(t, [image])
  await writeFile(join(root, image.source), Buffer.alloc(imageByteLimit + 1))
  workspace.asset = () => assert.fail('oversized images must not be read')
  const result = await inspectAsset(workspace, { id: 'icon' })
  assert.equal(result.metadata.reason, 'IMAGE_TOO_LARGE')
  assert.equal(result.metadata.bytes, imageByteLimit + 1)
  assert.equal(result.metadata.imageAvailable, false)
  await assert.rejects(inspectAsset(workspace, { id: 'icon', includeImage: true }), { code: 'IMAGE_TOO_LARGE' })
})

test('image bytes pass through unchanged and decoding is left to the MCP client', async t => {
  const { root, workspace } = await fixture(t, [image])
  const png = await readFile(new URL('../template/assets/marks/slow.png', import.meta.url))
  const truncated = png.subarray(0, png.length - 12)
  await writeFile(join(root, image.source), truncated)
  const result = await inspectAsset(workspace, { id: 'icon', includeImage: true })
  assert.equal(result.image.mimeType, 'image/png')
  assert.deepEqual(Buffer.from(result.image.data, 'base64'), truncated)
  assert.equal(result.metadata.width, undefined)
  assert.equal(result.metadata.height, undefined)
})

test('MIME follows filenames and unknown formats remain metadata only', async t => {
  const records = [
    { id: 'gif', kind: 'image', source: 'assets/animation.GIF' },
    { id: 'unknown', kind: 'image', source: 'assets/icon.bin' },
    { id: 'mismatch', kind: 'audio', source: 'assets/audio.png' },
  ]
  const { root, workspace } = await fixture(t, records)
  for (const record of records) await writeFile(join(root, record.source), 'content supplied by the author')
  assert.equal((await inspectAsset(workspace, { id: 'gif', includeImage: true })).image.mimeType, 'image/gif')
  const unknown = await inspectAsset(workspace, { id: 'unknown' })
  assert.equal(unknown.metadata.mimeType, 'application/octet-stream')
  assert.equal(unknown.metadata.reason, 'IMAGE_FORMAT_UNKNOWN')
  assert.equal(unknown.metadata.imageAvailable, false)
  await assert.rejects(inspectAsset(workspace, { id: 'unknown', includeImage: true }), {
    code: 'IMAGE_FORMAT_UNKNOWN',
  })
  await assert.rejects(inspectAsset(workspace, { id: 'mismatch' }), { code: 'RESOURCE_KIND_MISMATCH' })
})
