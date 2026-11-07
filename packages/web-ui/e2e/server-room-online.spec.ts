import { expect, test, type Page } from 'playwright/test'

test.setTimeout(120_000)

async function openLobby(page: Page, name: string) {
  await page.addInitScript(name => {
    const profile = { id: 'same-local-profile', name }
    localStorage.setItem('player', JSON.stringify(profile))
    localStorage.setItem('player-data', JSON.stringify(profile))
    localStorage.setItem('gameSetting.battleRenderer', '"image"')
  }, name)
  await page.goto('/')
  await expect(page.getByTestId('create-private-room-button')).toBeEnabled({ timeout: 30_000 })
}

async function identity(page: Page): Promise<{ profileId?: string; sessionId?: string; seatId?: string }> {
  return page.evaluate(() => {
    const debug = (
      window as typeof window & {
        __APP_DEBUG__?: {
          stores: { auth: () => { session: { profile: { id: string }; sessionId: string; seatId: string } | null } }
        }
      }
    ).__APP_DEBUG__
    const session = debug?.stores.auth().session
    return { profileId: session?.profile.id, sessionId: session?.sessionId, seatId: session?.seatId }
  })
}

test('two tabs with the same local UID obtain separate server seats and enter a server battle', async ({ browser }) => {
  const hostContext = await browser.newContext()
  const guestContext = await browser.newContext()
  try {
    const host = await hostContext.newPage()
    const guest = await guestContext.newPage()
    await openLobby(host, 'Host')
    await openLobby(guest, 'Guest')
    const hostIdentity = await identity(host)
    const guestIdentity = await identity(guest)
    expect(hostIdentity.profileId).toBe('same-local-profile')
    expect(guestIdentity.profileId).toBe('same-local-profile')
    expect(hostIdentity.sessionId).toBeTruthy()
    expect(hostIdentity.sessionId).not.toBe(guestIdentity.sessionId)
    expect(hostIdentity.seatId).toBeTruthy()
    expect(hostIdentity.seatId).not.toBe(guestIdentity.seatId)

    const roomCode = await host.evaluate(async () => {
      const debug = (
        window as typeof window & {
          __APP_DEBUG__?: {
            createPrivateRoom: (config: { battleMode: 'server'; timerConfig: { enabled: boolean } }) => Promise<string>
          }
        }
      ).__APP_DEBUG__
      if (!debug) throw new Error('Missing room test hook')
      return debug.createPrivateRoom({ battleMode: 'server', timerConfig: { enabled: false } })
    })
    await host.goto(`/room/${roomCode}`)
    await guest.getByTestId('join-room-code-input').fill(roomCode)
    await guest.getByTestId('join-private-room-button').click()
    await expect(host.getByText('玩家 (2/2)')).toBeVisible({ timeout: 30_000 })
    await expect(guest.getByText('玩家 (2/2)')).toBeVisible()

    const beforeReload = await identity(guest)
    await guest.reload()
    await expect(guest.getByText('玩家 (2/2)')).toBeVisible({ timeout: 30_000 })
    expect(await identity(guest)).toEqual(beforeReload)

    for (const page of [host, guest]) {
      const team = page.getByTestId('room-team-selector').locator('[data-testid="team-option-0"]').first()
      await expect(team).toBeVisible({ timeout: 20_000 })
      await team.click()
    }
    await guest.getByTestId('toggle-ready-button').click()
    await expect(guest.getByTestId('toggle-ready-button')).toContainText('取消准备')
    const start = host.getByTestId('start-battle-button')
    await expect(start).toBeEnabled({ timeout: 20_000 })
    await start.click()
    await expect.poll(() => host.url(), { timeout: 30_000 }).toMatch(/\/battle\?.*privateRoom=true/)
    await expect.poll(() => guest.url(), { timeout: 30_000 }).toMatch(/\/battle\?.*privateRoom=true/)
    await expect(host.getByRole('button', { name: '战斗', exact: true })).toBeVisible({ timeout: 45_000 })
    await expect(guest.getByRole('button', { name: '战斗', exact: true })).toBeVisible({ timeout: 45_000 })
    expect(host.url()).not.toContain('p2p=true')
    expect(guest.url()).not.toContain('p2p=true')
    expect((await identity(host)).seatId).not.toBe((await identity(guest)).seatId)
    await guest.reload()
    await expect.poll(() => identity(guest), { timeout: 30_000 }).toEqual(beforeReload)
    await expect.poll(() => guest.url(), { timeout: 30_000 }).toMatch(/\/battle\?.*privateRoom=true/)
    await expect(guest.getByRole('button', { name: '战斗', exact: true })).toBeVisible({ timeout: 45_000 })
  } finally {
    await hostContext.close()
    await guestContext.close()
  }
})
