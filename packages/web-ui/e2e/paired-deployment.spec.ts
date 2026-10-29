import { expect, test, type Page } from 'playwright/test'

test.setTimeout(120_000)

async function openLobby(page: Page, name: string) {
  await page.addInitScript(name => {
    const profile = { id: `paired-${name}`, name }
    localStorage.setItem('player', JSON.stringify(profile))
    localStorage.setItem('player-data', JSON.stringify(profile))
    localStorage.setItem('gameSetting.battleRenderer', '"image"')
    sessionStorage.setItem('arcadia-selected-server', 'https://invalid.test')
  }, name)
  await page.goto('/?server=https://invalid.test')
  await expect(page.getByTestId('create-private-room-button')).toBeEnabled({ timeout: 30_000 })
  await expect(page.getByTestId('server-address-input')).toHaveCount(0)
}

test('paired site supports guests, team selection, invitations, battle and refresh', async ({ browser, baseURL }) => {
  const hostContext = await browser.newContext()
  const guestContext = await browser.newContext()
  try {
    const host = await hostContext.newPage()
    const guest = await guestContext.newPage()
    await openLobby(host, 'Host')
    await openLobby(guest, 'Guest')
    await host.getByTestId('create-private-room-button').click()
    const timer = host.getByRole('dialog').getByRole('switch').first()
    if ((await timer.getAttribute('aria-checked')) === 'true') await timer.click()
    await host.getByTestId('confirm-create-private-room-button').click()
    await expect(host).toHaveURL(/\/room\/[A-Za-z0-9]+/, { timeout: 30_000 })
    const invite = host.url()
    expect(new URL(invite).origin).toBe(new URL(baseURL!).origin)
    await guest.goto(invite)
    await expect(host.getByText('玩家 (2/2)')).toBeVisible({ timeout: 30_000 })
    await guest.reload()
    await expect(guest.getByText('玩家 (2/2)')).toBeVisible({ timeout: 30_000 })
    for (const page of [host, guest]) {
      const team = page.getByTestId('room-team-selector').getByTestId('team-option-0').first()
      await expect(team).toBeVisible({ timeout: 20_000 })
      await team.click()
    }
    await guest.getByTestId('toggle-ready-button').click()
    const start = host.getByTestId('start-battle-button')
    await expect(start).toBeEnabled({ timeout: 20_000 })
    await start.click()
    for (const page of [host, guest]) {
      await expect(page).toHaveURL(/\/battle\?.*privateRoom=true/, { timeout: 30_000 })
      await expect(page.getByRole('button', { name: '战斗', exact: true })).toBeVisible({ timeout: 45_000 })
    }
    await guest.reload()
    await expect(guest.getByRole('button', { name: '战斗', exact: true })).toBeVisible({ timeout: 45_000 })
  } finally {
    await hostContext.close()
    await guestContext.close()
  }
})
