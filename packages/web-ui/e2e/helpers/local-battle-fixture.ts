import type { Page } from 'playwright/test'

/** Keep runtime smoke tests independent of the remote scene CDN. */
export async function prepareLocalBattle(page: Page, portraitDelayMs = 0) {
  await page.addInitScript(() => localStorage.setItem('gameSetting.battleRenderer', '"image"'))
  await page.route('**/png/battleBackground/*.png', route =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#283546"/></svg>',
    }),
  )
  await page.route('**/png/pet/*.png', async route => {
    if (portraitDelayMs) await new Promise(resolve => setTimeout(resolve, portraitDelayMs))
    await route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><circle cx="60" cy="60" r="45" fill="#7e9bbc"/></svg>',
    })
  })
}
