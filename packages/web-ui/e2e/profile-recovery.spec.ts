import { test, expect } from 'playwright/test'

test('offline profile survives reload and restores into a clean browser context', async ({
  page,
  browser,
  baseURL,
}) => {
  await page.route('**/api/**', route => route.abort())
  await page.goto('/profile')
  await expect(page.getByRole('heading', { name: '个人资料', exact: true })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: '已保存' })).toBeVisible()
  const uid = await page.locator('section code').first().innerText()
  await page.reload()
  await expect(page.locator('section code').first()).toHaveText(uid)
  const exported = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出资料', exact: true }).click()
  const download = await exported,
    stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  const backup = Buffer.concat(chunks)
  const context = await browser.newContext({ baseURL })
  try {
    const target = await context.newPage()
    await target.route('**/api/**', route => route.abort())
    await target.goto('/profile')
    await expect(target.getByRole('status').filter({ hasText: '已保存' })).toBeVisible()
    await target
      .locator('input[type=file]')
      .setInputFiles({ name: 'backup.arcadia-profile.json', mimeType: 'application/json', buffer: backup })
    await target.getByRole('button', { name: '恢复此资料' }).click()
    await target.getByRole('button', { name: '恢复资料', exact: true }).click()
    await expect(target.locator('section code').first()).toHaveText(uid)
    await target.reload()
    await expect(target.locator('section code').first()).toHaveText(uid)
    const again = target.waitForEvent('download')
    await target.getByRole('button', { name: '导出资料', exact: true }).click()
    const result = await (await again).createReadStream(),
      parts: Buffer[] = []
    for await (const part of result!) parts.push(Buffer.from(part))
    expect(JSON.parse(Buffer.concat(parts).toString()).data).toEqual(JSON.parse(backup.toString()).data)
  } finally {
    await context.close()
  }
})

test('migrates legacy data once, excludes credentials and leaves source keys untouched', async ({ page }) => {
  const legacy = {
    'player-data': JSON.stringify({ id: 'legacy-uid', name: '旧玩家' }),
    player: JSON.stringify({ id: 'legacy-uid', name: '旧玩家' }),
    petStorage: JSON.stringify({
      storage: [],
      teams: [
        { name: '甲队', pets: [], ruleSetId: 'missing:rules' },
        { name: '乙队', pets: [], ruleSetId: 'casual_standard_ruleset' },
      ],
      currentTeamIndex: 1,
    }),
    'gameSetting.musicVolume': '17',
    'gameSetting.battleRenderer': '"image"',
    'server-session:fixture': 'private-token-fixture',
  }
  await page.addInitScript(values => {
    for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value)
  }, legacy)
  await page.route('**/api/**', route => route.abort())
  await page.goto('/profile')
  await expect(page.getByRole('status')).toHaveText('已保存')
  await expect(page.locator('section code').first()).toHaveText('legacy-uid')
  const exported = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出资料', exact: true }).click()
  const stream = await (await exported).createReadStream(),
    parts: Buffer[] = []
  for await (const part of stream!) parts.push(Buffer.from(part))
  const text = Buffer.concat(parts).toString(),
    result = JSON.parse(text)
  expect(result.data.library.currentTeamIndex).toBe(1)
  expect(result.data.library.teams[0].ruleSetId).toBe('missing:rules')
  expect(result.data.settings.musicVolume).toBe(17)
  expect(result.data.settings.battleRenderer).toBe('image')
  expect(text).not.toContain('private-token-fixture')
  expect(
    await page.evaluate(
      keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])),
      Object.keys(legacy),
    ),
  ).toEqual(legacy)
})

test('legacy identity conflicts block initialization until an explicit choice', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('player', JSON.stringify({ id: 'old-a', name: 'A' }))
    localStorage.setItem('player-data', JSON.stringify({ id: 'old-b', name: 'B' }))
  })
  await page.route('**/api/**', route => route.abort())
  await page.goto('/profile')
  await expect(page.getByRole('status')).toHaveText('需要恢复')
  await page.getByRole('button', { name: '使用 player 资料', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('已保存')
  await expect(page.locator('section code').first()).toHaveText('old-a')
  await page.reload()
  await expect(page.locator('section code').first()).toHaveText('old-a')
})

test('first-save failure retains the candidate UID when storage becomes writable', async ({ page }) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put
    let reject = true
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (reject && this.name === 'profile') {
        reject = false
        throw new DOMException('Fixture quota failure', 'QuotaExceededError')
      }
      return put.apply(this, args)
    }
  })
  await page.route('**/api/**', route => route.abort())
  await page.goto('/profile')
  await expect(page.getByRole('status')).toHaveText('需要恢复')
  const uid = await page.locator('section code').first().innerText()
  await page.getByRole('button', { name: '重新读取', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('已保存')
  await expect(page.locator('section code').first()).toHaveText(uid)
})

test('uses the valid legacy identity and exports corrupt source bytes separately', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('player', JSON.stringify({ id: 'good-uid', name: 'Good' }))
    localStorage.setItem('player-data', '{broken')
    localStorage.setItem('server-session:secret', 'never-export-this')
  })
  await page.route('**/api/**', route => route.abort())
  await page.goto('/profile')
  await expect(page.getByRole('status')).toHaveText('已保存')
  await expect(page.locator('section code').first()).toHaveText('good-uid')
  const exported = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出旧原始数据' }).click()
  const stream = await (await exported).createReadStream(),
    parts: Buffer[] = []
  for await (const part of stream!) parts.push(Buffer.from(part))
  const raw = Buffer.concat(parts).toString()
  expect(JSON.parse(raw)['player-data']).toBe('{broken')
  expect(raw).not.toContain('never-export-this')
})

test('a new web profile retains the existing starter team across reloads', async ({ page }) => {
  const { readPersistedProfile } = await import('./helpers/profile')
  await page.route('**/api/**', route => route.abort())
  await page.goto('/profile')
  await expect(page.getByRole('status')).toHaveText('已保存')
  const first = await readPersistedProfile(page)
  expect(first?.library.teams[0].pets.map(pet => pet.species)).toEqual(['pet_xiuluosi', 'pet_dilante', 'pet_laaoye'])
  await page.reload()
  await expect(page.getByRole('status')).toHaveText('已保存')
  expect((await readPersistedProfile(page))?.library).toEqual(first?.library)
})
