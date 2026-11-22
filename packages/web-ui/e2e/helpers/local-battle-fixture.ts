import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Page } from 'playwright/test'

function fixtureImage(path: string) {
  const body = readFileSync(new URL(path, import.meta.url))
  return { body, sha256: createHash('sha256').update(body).digest('hex') }
}

const background = fixtureImage('../../public/favicon.png')
const portrait = fixtureImage('../../src/assets/logo.png')
const backgroundUrl = /^https:\/\/seer2-resource\.yuuinih\.com\/png\/battleBackground\/[^/]+\.png$/
const portraitUrl = /^https:\/\/seer2-resource\.yuuinih\.com\/png\/pet\/[^/]+\.png$/

/** Keep runtime smoke tests independent of the remote scene CDN while exercising normal integrity checks. */
export async function prepareLocalBattle(page: Page, portraitDelayMs = 0) {
  await page.addInitScript(() => localStorage.setItem('gameSetting.battleRenderer', '"image"'))
  await page.route('**/environment/catalog.json', async route => {
    const response = await route.fetch()
    const catalog = await response.json()
    for (const resource of catalog.resources) {
      if (backgroundUrl.test(resource.source)) resource.sha256 = background.sha256
      if (portraitUrl.test(resource.source)) resource.sha256 = portrait.sha256
    }
    await route.fulfill({ response, json: catalog })
  })
  await page.route(backgroundUrl, route => route.fulfill({ contentType: 'image/png', body: background.body }))
  await page.route(portraitUrl, async route => {
    if (portraitDelayMs) await new Promise(resolve => setTimeout(resolve, portraitDelayMs))
    await route.fulfill({ contentType: 'image/png', body: portrait.body })
  })
}
