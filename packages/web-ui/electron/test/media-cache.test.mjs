import { it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { desktopMediaCache } from '../media-cache.mjs'

const hash = data => createHash('sha256').update(data).digest('hex')
const url = 'https://example.test/sprite'
const bytes = Buffer.from('movie')
const address = 'https://arcadia-media.invalid/sha256/' + hash(bytes)

it('reopens by digest across environments, isolates mutable URLs and recovers from a damaged cache', async t => {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-media-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const cache = desktopMediaCache(root)
  assert.deepEqual(await cache.usage('A'), { files: 0, bytes: 0 })
  await cache.write('A', url, bytes)
  assert.deepEqual(await cache.usage('A'), { files: 1, bytes: bytes.length })
  assert.equal(await cache.has('A', url, 100), true)
  assert.equal(await cache.has('B', url, 100), false)
  assert.equal(await cache.has('B', address, 100), true)
  assert.equal(await cache.has('B', address, 100, true), false)
  assert.equal(await cache.has('B', address, 1), false)
  assert.equal(await cache.read('B', url, 100), null)
  assert.deepEqual(await desktopMediaCache(root).read('B', address, 100), bytes)
  await cache.write('B', address, bytes)
  await writeFile(join(root, 'media', hash('B'), hash(address)), 'damaged')
  assert.deepEqual(await cache.read('B', address, 100), bytes)
  await assert.rejects(cache.write('B', address, Buffer.from('other')))
  await cache.clear('A')
  assert.deepEqual(await cache.usage('A'), { files: 0, bytes: 0 })
  assert.equal(await cache.read('B', address, 100), null)
})

it('migrates an official legacy SWF only when its content matches', async t => {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-media-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'pets'))
  await writeFile(join(root, 'pets', '1.swf'), bytes)
  const cache = desktopMediaCache(root)
  const original = 'https://seer2-pet-resource.yuuinih.com/public/fight/1.swf'
  assert.equal(await cache.read('A', 'https://arcadia-media.invalid/sha256/' + hash('other'), 100, original), null)
  assert.deepEqual(await cache.read('A', address, 100, url), bytes)
  assert.deepEqual(await cache.read('B', address, 100, url), bytes)
})
