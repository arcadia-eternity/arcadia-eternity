import { expect, test, type BrowserContext, type Page } from 'playwright/test'

test.setTimeout(180_000)

const requestedTransport = (process.env.PLAYWRIGHT_P2P_TRANSPORT ?? 'relay') as 'relay' | 'webrtc' | 'auto'

const ALLOWED_CONSOLE_PATTERNS = [
  /未找到标记图片/i,
  /Failed to load resource: the server responded with a status of 404/i,
  /Background image loading timeout/i,
  /Pet sprites not ready after maximum retries/i,
  /No available adapters\./i,
  /已离开房间/i,
  /No species data provider available/i,
  /PLAYER_NOT_FOUND/i,
  /Check player status error/i,
  /ElementPlusError: \[props\] \[API\] type\.text is about to be deprecated/i,
  /Failed to apply state delta for SKILL_USE/i,
  /StateDelta: \{players: Object\}/i,
  /Current battleState: Proxy\(Object\)/i,
  /动画执行失败: Error: 找不到精灵组件/i,
  /Failed to get player all ELOs/i,
  /Failed to fetch player ELOs/i,
  /WebSocket connection to 'ws:\/\/127\.0\.0\.1:\d+\/socket\.io\/.*transport=websocket.*Unexpected response code: 400/i,
  /Serious error loading Ruffle/i,
  /Serious error occurred loading SWF file/i,
  /Failed to preload pet \d+: TypeError: Failed to fetch/i,
]

function collectUnexpectedConsole(page: Page) {
  const unexpectedConsoleErrors: string[] = []
  const debugConsole: string[] = []
  page.on('console', message => {
    debugConsole.push(`${message.type()}: ${message.text()}`)
    if (message.type() !== 'error' && message.type() !== 'warning') return
    const text = message.text()
    if (ALLOWED_CONSOLE_PATTERNS.some(pattern => pattern.test(text))) return
    unexpectedConsoleErrors.push(`${message.type()}: ${text}`)
  })
  return { unexpectedConsoleErrors, debugConsole }
}

async function logStage(page: Page, stage: string) {
  const url = page.url()
  const connectionText = await page.getByText(/已连接|连接中|连接断开/).first().textContent().catch(() => null)
  console.log(`[E2E][${stage}] url=${url} connection=${connectionText ?? 'unknown'}`)
}

async function openFreshLobby(context: BrowserContext) {
  const page = await context.newPage()
  const { unexpectedConsoleErrors, debugConsole } = collectUnexpectedConsole(page)
  const createRoomButton = page.getByTestId('create-private-room-button')
  const disconnectedBadge = page.getByText('连接断开')

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    if (await createRoomButton.isVisible({ timeout: 20_000 }).catch(() => false)) {
      break
    }
    await page.reload({ waitUntil: 'domcontentloaded' })
  }

  await expect(createRoomButton).toBeVisible({ timeout: 30_000 })
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (await createRoomButton.isEnabled().catch(() => false)) {
      break
    }
    if (attempt >= 4 && (await disconnectedBadge.isVisible().catch(() => false))) {
      await disconnectedBadge.click({ force: true })
    }
    await page.waitForTimeout(3_000)
  }

  try {
    await expect(createRoomButton).toBeEnabled({ timeout: 20_000 })
  } catch (error) {
    const connectionStatus = await page.locator('body').textContent().catch(() => '')
    console.log('LOBBY DEBUG URL', page.url())
    console.log('LOBBY DEBUG BODY\n' + (connectionStatus ?? ''))
    console.log('LOBBY DEBUG CONSOLE\n' + debugConsole.join('\n'))
    throw error
  }
  await logStage(page, 'lobby-ready')
  return { page, unexpectedConsoleErrors, debugConsole }
}

async function createPrivateRoom(page: Page) {
  await logStage(page, 'before-create-room')
  let roomCode: string
  try {
    roomCode = await page.evaluate(async transport => {
      const debug = (window as typeof window & {
        __APP_DEBUG__?: {
          createPrivateRoom?: (config: {
            ruleSetId?: string
            isPrivate?: boolean
            password?: string
            p2pTransport?: 'auto' | 'webrtc' | 'relay'
          }) => Promise<string>
        }
      }).__APP_DEBUG__

      if (!debug?.createPrivateRoom) {
        throw new Error('createPrivateRoom debug hook unavailable')
      }

      return await Promise.race([
        debug.createPrivateRoom({
          ruleSetId: 'casual_standard_ruleset',
          isPrivate: false,
          p2pTransport: transport,
        }),
        new Promise<string>((_, reject) => {
          window.setTimeout(() => {
            reject(
              new Error(
                JSON.stringify({
                  type: 'createPrivateRoom-timeout',
                  href: window.location.href,
                  readyState: document.readyState,
                  hasDebug: !!debug,
                  hasCreatePrivateRoom: !!debug?.createPrivateRoom,
                }),
              ),
            )
          }, 5000)
        }),
      ])
    }, requestedTransport)
  } catch (error) {
    const debugInfo = await page.evaluate(() => {
      const win = window as typeof window & {
        __APP_DEBUG__?: {
          createPrivateRoom?: unknown
          stores?: unknown
        }
      }
      return {
        href: window.location.href,
        hasDebug: !!win.__APP_DEBUG__,
        hasCreatePrivateRoom: !!win.__APP_DEBUG__?.createPrivateRoom,
        createPrivateRoomType: typeof win.__APP_DEBUG__?.createPrivateRoom,
        hasStores: !!win.__APP_DEBUG__?.stores,
        bodyText: document.body?.textContent ?? '',
      }
    })
    console.log('CREATE ROOM EVALUATE ERROR', error)
    console.log('CREATE ROOM DEBUG INFO', JSON.stringify(debugInfo, null, 2))
    throw error
  }
  await page.goto(`/room/${roomCode}`)
  expect(roomCode).toBeTruthy()
  await expect(page.getByRole('heading', { name: new RegExp(`房间 ${roomCode}`) })).toBeVisible()
  await logStage(page, `room-created:${roomCode}`)
  return roomCode!
}

async function joinPrivateRoom(page: Page, roomCode: string) {
  await logStage(page, `before-join-room:${roomCode}`)
  await page.getByTestId('join-room-code-input').fill(roomCode)
  await page.getByTestId('join-private-room-button').click()
  await page.waitForURL(new RegExp(`/room/${roomCode}$`))
  await expect(page.getByRole('heading', { name: new RegExp(`房间 ${roomCode}`) })).toBeVisible()
  await logStage(page, `room-joined:${roomCode}`)
}

async function waitForRoomPopulation(hostPage: Page, guestPage: Page, hostDebug: string[], guestDebug: string[]) {
  try {
    await expect(hostPage.getByText('玩家 (2/2)')).toBeVisible({ timeout: 15_000 })
    await logStage(hostPage, 'host-saw-2-2')
    await expect(guestPage.getByText('玩家 (2/2)')).toBeVisible({ timeout: 15_000 })
    await logStage(guestPage, 'guest-saw-2-2')
  } catch (error) {
    console.log('HOST DEBUG CONSOLE\n' + hostDebug.join('\n'))
    console.log('GUEST DEBUG CONSOLE\n' + guestDebug.join('\n'))
    console.log('HOST BODY\n' + ((await hostPage.locator('body').textContent().catch(() => '')) ?? ''))
    console.log('GUEST BODY\n' + ((await guestPage.locator('body').textContent().catch(() => '')) ?? ''))
    throw error
  }
}

async function selectDefaultTeam(page: Page) {
  const teamOption = page.getByTestId('room-team-selector').locator('[data-testid="team-option-0"]').first()
  await expect(teamOption).toBeVisible({ timeout: 20_000 })
  await teamOption.click()
}

async function enterP2PBattle(
  hostPage: Page,
  guestPage: Page,
  hostDebug: string[],
  guestDebug: string[],
  options: { waitForReady?: boolean } = {},
) {
  await selectDefaultTeam(hostPage)
  await selectDefaultTeam(guestPage)

  const guestReadyButton = guestPage.getByTestId('toggle-ready-button')
  await expect(guestReadyButton).toBeEnabled({ timeout: 20_000 })
  await guestReadyButton.click()
  await expect(guestReadyButton).toContainText('取消准备', { timeout: 20_000 })

  const startBattleButton = hostPage.getByTestId('start-battle-button')
  await expect(startBattleButton).toBeEnabled({ timeout: 20_000 })
  await startBattleButton.click()

  try {
    await expect
      .poll(() => hostPage.url(), { timeout: 30_000, message: 'Host did not navigate to private P2P battle page' })
      .toMatch(/\/battle\?.*privateRoom=true.*p2p=true/)
    await expect
      .poll(() => guestPage.url(), { timeout: 30_000, message: 'Guest did not navigate to private P2P battle page' })
      .toMatch(/\/battle\?.*privateRoom=true.*p2p=true/)
  } catch (error) {
    console.log('HOST DEBUG CONSOLE\n' + hostDebug.join('\n'))
    console.log('GUEST DEBUG CONSOLE\n' + guestDebug.join('\n'))
    throw error
  }

  if (options.waitForReady !== false) {
    await waitForBattleInteractionReady(hostPage)
    await waitForBattleInteractionReady(guestPage)
  }
}

function skillButtons(page: Page) {
  return page.locator('button')
}

function skillButton(page: Page, skillName: string) {
  return skillButtons(page).filter({ hasText: skillName }).first()
}

function enabledSkillButtons(page: Page) {
  return page.locator('button:not([disabled])').filter({ hasText: /气力|奋力突破|佯攻|烈焰绝袭击|迪休拉之怒/ })
}

function firstEnabledSkillButton(page: Page) {
  return enabledSkillButtons(page).first()
}

function battleLogEntry(page: Page, text: string) {
  return page.getByText(text).first()
}

async function waitForBattleInteractionReady(page: Page, timeout = 60_000) {
  await expect(page.getByRole('button', { name: '战斗', exact: true })).toBeVisible({ timeout })
  await expect(page.getByTestId('battle-loading-overlay')).toHaveCount(0, { timeout })
  await expect
    .poll(async () => {
      return await enabledSkillButtons(page).count().catch(() => 0)
    }, {
      timeout,
      message: `No visible enabled battle action button found within ${timeout}ms`,
    })
    .toBeGreaterThan(0)
}

test('online private room can be created and joined by two guests', async ({ browser }) => {
  const hostContext = await browser.newContext()
  const guestContext = await browser.newContext()

  const { page: hostPage, unexpectedConsoleErrors: hostConsole, debugConsole: hostDebug } = await openFreshLobby(hostContext)
  const { page: guestPage, unexpectedConsoleErrors: guestConsole, debugConsole: guestDebug } = await openFreshLobby(guestContext)

  const roomCode = await createPrivateRoom(hostPage)
  await joinPrivateRoom(guestPage, roomCode)

  await waitForRoomPopulation(hostPage, guestPage, hostDebug, guestDebug)
  await expect(hostPage.getByText(/等待玩家加入/)).toHaveCount(0)

  expect(hostConsole).toEqual([])
  expect(guestConsole).toEqual([])
  test.info().attach('host-console', { body: hostDebug.join('\n'), contentType: 'text/plain' })
  test.info().attach('guest-console', { body: guestDebug.join('\n'), contentType: 'text/plain' })

  await hostContext.close()
  await guestContext.close()
})

test('online private room can start a p2p battle', async ({ browser }) => {
  const hostContext = await browser.newContext()
  const guestContext = await browser.newContext()

  const { page: hostPage, unexpectedConsoleErrors: hostConsole, debugConsole: hostDebug } = await openFreshLobby(hostContext)
  const { page: guestPage, unexpectedConsoleErrors: guestConsole, debugConsole: guestDebug } = await openFreshLobby(guestContext)

  const roomCode = await createPrivateRoom(hostPage)
  await joinPrivateRoom(guestPage, roomCode)

  await waitForRoomPopulation(hostPage, guestPage, hostDebug, guestDebug)

  await enterP2PBattle(hostPage, guestPage, hostDebug, guestDebug, { waitForReady: false })

  expect(hostConsole).toEqual([])
  expect(guestConsole).toEqual([])
  test.info().attach('host-console', { body: hostDebug.join('\n'), contentType: 'text/plain' })
  test.info().attach('guest-console', { body: guestDebug.join('\n'), contentType: 'text/plain' })

  await hostContext.close()
  await guestContext.close()
})

test('online p2p battle can submit actions and sync battle log', async ({ browser }) => {
  const hostContext = await browser.newContext()
  const guestContext = await browser.newContext()

  const { page: hostPage, unexpectedConsoleErrors: hostConsole, debugConsole: hostDebug } = await openFreshLobby(hostContext)
  const { page: guestPage, unexpectedConsoleErrors: guestConsole, debugConsole: guestDebug } =
    await openFreshLobby(guestContext)

  const roomCode = await createPrivateRoom(hostPage)
  await joinPrivateRoom(guestPage, roomCode)

  await waitForRoomPopulation(hostPage, guestPage, hostDebug, guestDebug)

  try {
    await enterP2PBattle(hostPage, guestPage, hostDebug, guestDebug)

    const hostQiLiButton = skillButton(hostPage, '气力')
    const guestQiLiButton = skillButton(guestPage, '气力')

    await expect(hostQiLiButton).toBeEnabled({ timeout: 20_000 })
    await expect(guestQiLiButton).toBeEnabled({ timeout: 20_000 })

    console.log('[E2E][before-skill-click] host=%s guest=%s', hostPage.url(), guestPage.url())
    await guestQiLiButton.click()
    await hostQiLiButton.click()
    console.log('[E2E][after-skill-click] host=%s guest=%s', hostPage.url(), guestPage.url())

    await expect(battleLogEntry(hostPage, '休罗斯 使用 气力')).toBeVisible({ timeout: 30_000 })
    await expect(battleLogEntry(guestPage, '休罗斯 使用 气力')).toBeVisible({ timeout: 30_000 })
  } catch (error) {
    console.log('HOST DEBUG CONSOLE\n' + hostDebug.join('\n'))
    console.log('GUEST DEBUG CONSOLE\n' + guestDebug.join('\n'))
    throw error
  }

  expect(hostConsole).toEqual([])
  expect(guestConsole).toEqual([])

  await hostContext.close()
  await guestContext.close()
})

test('online p2p peer can reload battle page and rejoin active battle', async ({ browser }) => {
  const hostContext = await browser.newContext()
  const guestContext = await browser.newContext()

  const { page: hostPage, unexpectedConsoleErrors: hostConsole, debugConsole: hostDebug } = await openFreshLobby(hostContext)
  const { page: guestPage, unexpectedConsoleErrors: guestConsole, debugConsole: guestDebug } =
    await openFreshLobby(guestContext)

  const roomCode = await createPrivateRoom(hostPage)
  await joinPrivateRoom(guestPage, roomCode)

  await waitForRoomPopulation(hostPage, guestPage, hostDebug, guestDebug)

  await enterP2PBattle(hostPage, guestPage, hostDebug, guestDebug)

  try {
    await guestPage.reload()
    await expect
      .poll(() => guestPage.url(), { timeout: 30_000, message: 'Guest did not return to private P2P battle page' })
      .toMatch(/\/battle\?.*privateRoom=true.*p2p=true/)
    await waitForBattleInteractionReady(guestPage, 90_000)

    const hostQiLiButton = firstEnabledSkillButton(hostPage)
    const guestQiLiButton = firstEnabledSkillButton(guestPage)

    await expect(hostQiLiButton).toBeEnabled({ timeout: 20_000 })
    await expect(guestQiLiButton).toBeEnabled({ timeout: 20_000 })

    await guestQiLiButton.click()
    await hostQiLiButton.click()

    await expect(battleLogEntry(hostPage, '休罗斯 使用 气力')).toBeVisible({ timeout: 30_000 })
    await expect(battleLogEntry(guestPage, '休罗斯 使用 气力')).toBeVisible({ timeout: 30_000 })
  } catch (error) {
    console.log('HOST DEBUG CONSOLE\n' + hostDebug.join('\n'))
    console.log('GUEST DEBUG CONSOLE\n' + guestDebug.join('\n'))
    throw error
  }

  expect(hostConsole).toEqual([])
  expect(guestConsole).toEqual([])

  await hostContext.close()
  await guestContext.close()
})
