import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assetPath, collectOfficialAssetUrls, verifyAsset } from './prepare-static-assets.mjs'

test('the static asset inventory includes manifest resources and renderer-only resources', async () => {
  const urls = await collectOfficialAssetUrls()
  assert.equal(new Set(urls).size, urls.length)
  for (const url of [
    'https://seer2-pet-resource.yuuinih.com/public/fight/3.swf',
    'https://seer2-resource.yuuinih.com/png/pet/3.png',
    'https://seer2-resource.yuuinih.com/png/petIcon/3.png',
    'https://seer2-resource.yuuinih.com/sound/pet/3.mp3',
    'https://seer2-resource.yuuinih.com/sound/battle/ko.mp3',
    'https://seer2-resource.yuuinih.com/png/damage/miss.png',
    'https://seer2-resource.yuuinih.com/png/damageNumber/9.png',
  ])
    assert.ok(urls.includes(url), `${url} must be available without its CDN`)
  for (const url of urls) assert.ok(assetPath(url).startsWith('resource/') || assetPath(url).startsWith('pet/'))
})

test('only official origins can enter the mirrored build output', () => {
  assert.equal(assetPath('https://seer2-resource.yuuinih.com/png/pet/3.png'), 'resource/png/pet/3.png')
  assert.throws(() => assetPath('https://example.com/file.png'), /Unsupported official asset URL/)
  assert.throws(
    () => assetPath('https://seer2-resource.yuuinih.com/file.png?version=2'),
    /Unsupported official asset URL/,
  )
})

test('HTML errors and content that differs from the lock fail the build', () => {
  const url = 'https://seer2-resource.yuuinih.com/png/pet/3.png'
  assert.throws(() => verifyAsset(Buffer.from('<html>not found</html>'), url), /not a PNG/)
  assert.throws(() => verifyAsset(Buffer.alloc(0), url), /Empty/)
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
  const locked = verifyAsset(bytes, url)
  assert.deepEqual(verifyAsset(bytes, url, locked), locked)
  assert.throws(
    () => verifyAsset(Buffer.concat([bytes, Buffer.from([4])]), url, locked),
    /differs from the reviewed lock/,
  )
})
