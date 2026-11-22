import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Page } from 'playwright/test'

function fixture(body: Buffer) {
  return { body, sha256: createHash('sha256').update(body).digest('hex') }
}

function fixtureImage(path: string) {
  return fixture(readFileSync(new URL(path, import.meta.url)))
}

const background = fixtureImage('../../public/favicon.png')
const portrait = fixtureImage('../../src/assets/logo.png')
const damage = fixtureImage('../../src/assets/images/ko.png')
const lastDigit = fixtureImage('../../src/assets/images/climax_effect/91.png')
const cdnMedia = /^https:\/\/seer2-resource\.yuuinih\.com\/.+\.(?:png|mp3)$/
const portraitUrl = /^https:\/\/seer2-resource\.yuuinih\.com\/png\/pet\/[^/]+\.png$/

// Silent MPEG-1 Layer III frames at 128 kbps / 44.1 kHz. Give KO a distinct cache key.
const frame = Buffer.alloc(417)
frame.writeUInt32BE(0xfffb90c0)
const audio = fixture(Buffer.concat([frame, frame, frame, frame]))
const music = fixture(Buffer.concat([frame, frame, frame, frame, frame]))
const ko = fixture(Buffer.concat([frame, frame, frame]))
function mediaFixture(url: string) {
  if (url.endsWith('/battle/ko.mp3')) return ko
  if (url.includes('/music/')) return music
  if (url.endsWith('.mp3')) return audio
  if (url.endsWith('/damageNumber/9.png')) return lastDigit
  if (url.includes('/damage')) return damage
  if (portraitUrl.test(url)) return portrait
  return background
}

/** Keep runtime smoke tests independent of the remote scene CDN while exercising normal integrity checks. */
export async function prepareLocalBattle(page: Page, portraitDelayMs = 0) {
  await page.addInitScript(() => localStorage.setItem('gameSetting.battleRenderer', '"image"'))
  await page.route('**/environment/catalog.json', async route => {
    const response = await route.fetch()
    const catalog = await response.json()
    for (const resource of catalog.resources) {
      if (cdnMedia.test(resource.source)) resource.sha256 = mediaFixture(resource.source).sha256
    }
    await route.fulfill({ response, json: catalog })
  })
  await page.route(cdnMedia, async route => {
    const url = route.request().url()
    if (portraitDelayMs && portraitUrl.test(url)) await new Promise(resolve => setTimeout(resolve, portraitDelayMs))
    await route.fulfill({
      contentType: url.endsWith('.mp3') ? 'audio/mpeg' : 'image/png',
      body: mediaFixture(url).body,
    })
  })
}
