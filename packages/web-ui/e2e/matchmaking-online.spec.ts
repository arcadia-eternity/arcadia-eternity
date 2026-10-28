import { expect, test, type Page } from 'playwright/test'

test.setTimeout(180_000)
async function lobby(page: Page, name: string) {
  await page.addInitScript(name => {
    const profile = { id: 'same-local-profile', name }
    localStorage.setItem('player', JSON.stringify(profile))
    localStorage.setItem('player-data', JSON.stringify(profile))
    localStorage.setItem('gameSetting.battleRenderer', '"image"')
  }, name)
  await page.goto('/')
  await expect(page.getByTestId('open-matchmaking-button')).toBeEnabled({ timeout: 30_000 })
}
async function queue(page: Page) {
  await page.getByTestId('open-matchmaking-button').click()
  await expect(page.getByTestId('matchmaking-team-selector').getByTestId('team-option-0')).toBeVisible({
    timeout: 30_000,
  })
  await page.getByTestId('matchmaking-team-selector').getByTestId('team-option-0').click()
  await expect(page.getByTestId('start-matchmaking-button')).toBeEnabled()
  await page.getByTestId('start-matchmaking-button').click()
}

test('two fresh guests cancel, automatically match, play, reconnect, finish and match again', async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()])
  const pages = await Promise.all(contexts.map(context => context.newPage()))
  try {
    await Promise.all(pages.map((page, index) => lobby(page, `Player ${index}`)))
    const [a, b] = pages
    await queue(a)
    await expect(a.getByTestId('matchmaking-waiting')).toContainText('寻找对手')
    await a.getByTestId('cancel-matchmaking-button').click()
    await expect(a.getByTestId('start-matchmaking-button')).toBeEnabled()
    await a.getByTestId('start-matchmaking-button').click()
    await queue(b)
    for (const page of pages) {
      await expect(page).toHaveURL(/\/battle\?.*matchmaking=true/, { timeout: 45_000 })
      await expect(page.getByRole('button', { name: '战斗', exact: true })).toBeVisible({ timeout: 45_000 })
      await expect(page.getByTestId('battle-loading-overlay')).toHaveCount(0, { timeout: 45_000 })
    }
    const firstRoom = new URL(a.url()).searchParams.get('roomId')
    for (const page of pages) {
      const skill = page.locator('button').filter({ hasText: '气力' }).first()
      await expect(skill).toBeEnabled()
      await skill.click()
    }
    for (const page of pages) await expect(page.getByText('休罗斯 使用 气力').first()).toBeVisible({ timeout: 30_000 })
    await b.reload()
    await expect(b.getByRole('button', { name: '战斗', exact: true })).toBeVisible({ timeout: 45_000 })
    await expect(b.getByTestId('battle-loading-overlay')).toHaveCount(0, { timeout: 45_000 })
    await a.getByRole('button', { name: /逃跑|投降/, exact: true }).click()
    await a.getByRole('button', { name: '投降', exact: true }).click()
    for (const page of pages)
      await expect(page.getByRole('button', { name: '重新匹配', exact: true })).toBeVisible({ timeout: 30_000 })
    // The completed room is released without dismissing the result screen.
    await expect
      .poll(
        async () =>
          a.evaluate(() => {
            const debug = (
              window as typeof window & { __APP_DEBUG__?: { stores: { privateRoom: () => { currentRoom: unknown } } } }
            ).__APP_DEBUG__
            if (!debug) throw new Error('Missing application debug hook')
            return debug.stores.privateRoom().currentRoom
          }),
        { timeout: 15_000 },
      )
      .toBeNull()
    for (const page of pages) {
      await page.getByRole('button', { name: '重新匹配', exact: true }).click()
      await expect(page.getByTestId('start-matchmaking-button')).toBeEnabled({ timeout: 30_000 })
      await page.getByTestId('start-matchmaking-button').click()
    }
    for (const page of pages) await expect(page).toHaveURL(/\/battle\?.*matchmaking=true/, { timeout: 45_000 })
    expect(new URL(a.url()).searchParams.get('roomId')).not.toBe(firstRoom)
    expect(new URL(b.url()).searchParams.get('roomId')).toBe(new URL(a.url()).searchParams.get('roomId'))
  } finally {
    await Promise.all(contexts.map(context => context.close()))
  }
})
