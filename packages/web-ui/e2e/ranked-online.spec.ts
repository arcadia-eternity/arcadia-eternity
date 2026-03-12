import { expect, test, type BrowserContext, type Page } from 'playwright/test'

test.setTimeout(180_000)

const ALLOWED_CONSOLE_PATTERNS = [
  /未找到标记图片/i,
  /Failed to load resource: the server responded with a status of 404/i,
  /Background image loading timeout/i,
  /Pet sprites not ready after maximum retries/i,
  /No available adapters\./i,
  /No species data provider available/i,
  /Failed to get player all ELOs/i,
  /Failed to fetch player ELOs/i,
  /Check player status error/i,
  /WebSocket connection to .* failed/i,
  /Unexpected response code: 400/i,
  /精灵仓库数据校验失败/i,
  /Failed to execute 'structuredClone' on 'Window'/i,
  /ElementPlusError: \[props\] \[API\] type\.text is about to be deprecated/i,
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

async function seedCompetitiveTeam(context: BrowserContext) {
  await context.addInitScript(() => {
    const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }
    const evs = { hp: 4, atk: 252, def: 0, spa: 0, spd: 0, spe: 252 }
    const makeId = (n: number) => `p${String(n).padStart(20, '0')}`

    const pets = [
      {
        id: makeId(1),
        name: '迪蓝',
        species: 'pet_dilan',
        level: 100,
        evs,
        ivs,
        nature: 'Jolly',
        gender: 'Male',
        skills: [],
        ability: 'mark_ability_zhongjie',
        emblem: 'mark_emblem_zhuiji',
        height: 40,
        weight: 10,
      },
      {
        id: makeId(2),
        name: '迪迪蓝',
        species: 'pet_didilan',
        level: 100,
        evs,
        ivs,
        nature: 'Jolly',
        gender: 'Male',
        skills: [],
        ability: 'mark_ability_zhongjie',
        emblem: 'mark_emblem_zhuiji',
        height: 66,
        weight: 20,
      },
      {
        id: makeId(3),
        name: '迪兰特',
        species: 'pet_dilante',
        level: 100,
        evs,
        ivs,
        nature: 'Modest',
        gender: 'Male',
        skills: [],
        ability: 'mark_ability_zhongjie',
        emblem: 'mark_emblem_zhuiji',
        height: 100,
        weight: 30,
      },
      {
        id: makeId(4),
        name: '休咻咻',
        species: 'pet_xiuxiu',
        level: 100,
        evs,
        ivs,
        nature: 'Jolly',
        gender: 'Male',
        skills: [],
        ability: 'mark_ability_yanhuo',
        emblem: 'mark_emblem_nuhuo',
        height: 36,
        weight: 10,
      },
      {
        id: makeId(5),
        name: '休伊尔',
        species: 'pet_xiuyier',
        level: 100,
        evs,
        ivs,
        nature: 'Jolly',
        gender: 'Male',
        skills: [],
        ability: 'mark_ability_yanhuo',
        emblem: 'mark_emblem_nuhuo',
        height: 55,
        weight: 22,
      },
      {
        id: makeId(6),
        name: '休罗斯',
        species: 'pet_xiuluosi',
        level: 100,
        evs,
        ivs,
        nature: 'Jolly',
        gender: 'Male',
        skills: [],
        ability: 'mark_ability_yanhuo',
        emblem: 'mark_emblem_nuhuo',
        height: 77,
        weight: 39,
      },
    ]

    localStorage.setItem(
      'petStorage',
      JSON.stringify({
        storage: [],
        teams: [
          {
            name: '竞技E2E队伍',
            pets,
            ruleSetId: 'competitive_ruleset',
          },
        ],
        currentTeamIndex: 0,
        lastMatchingConfig: {
          teamIndex: 0,
          ruleSetId: 'competitive_ruleset',
          timestamp: Date.now(),
        },
      }),
    )
  })
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

  await expect(page.getByRole('heading', { name: '对战匹配大厅' })).toBeVisible({ timeout: 30_000 })
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
    console.log('RANKED LOBBY DEBUG URL', page.url())
    console.log('RANKED LOBBY DEBUG BODY\n' + (connectionStatus ?? ''))
    console.log('RANKED LOBBY DEBUG CONSOLE\n' + debugConsole.join('\n'))
    throw error
  }

  return { page, unexpectedConsoleErrors, debugConsole }
}

async function prepareCompetitiveQueue(page: Page) {
  const competitiveCard = page.locator('div.cursor-pointer').filter({ hasText: /竞技规则/ }).first()
  await expect(competitiveCard).toBeVisible({ timeout: 20_000 })
  await competitiveCard.click()

  const teamOption = page.getByTestId('team-option-0')
  await expect(teamOption).toBeVisible({ timeout: 20_000 })
  await teamOption.click()

  const matchButton = page
    .getByRole('button')
    .filter({
      hasText: /请先连接服务器|请选择游戏规则|请选择队伍|队伍不符合规则|开始匹配|取消匹配|准备进入战斗|不符合规则/,
    })
    .first()
  await expect(matchButton).toBeVisible({ timeout: 20_000 })
  await expect(matchButton).not.toContainText('请先连接服务器', { timeout: 20_000 })

  const label = (await matchButton.textContent())?.trim() ?? ''
  if (label.includes('不符合规则')) {
    throw new Error(`selected team is invalid for competitive rules: ${label}`)
  }
  if (label.includes('开始匹配')) {
    await expect(matchButton).toBeEnabled({ timeout: 20_000 })
    await matchButton.click()
  }
}

async function waitForRankedMatchedOrBattle(page: Page) {
  await expect
    .poll(
      async () => {
        const url = page.url()
        if (/\/battle\?roomId=/.test(url)) {
          return 'battle'
        }
        const text = (await page
          .getByRole('button')
          .filter({ hasText: /开始匹配|取消匹配|准备进入战斗|不符合规则/ })
          .first()
          .textContent()
          .catch(() => '')) as string
        if (text.includes('准备进入战斗')) return 'matched'
        if (text.includes('取消匹配')) return 'searching'
        if (text.includes('不符合规则')) return 'invalid'
        return 'idle'
      },
      { timeout: 60_000, message: 'ranked client did not reach matched/battle state in time' },
    )
    .toMatch(/battle|matched/)
}

test('online ranked queue can match two players into a server battle', async ({ browser }) => {
  const hostContext = await browser.newContext()
  const guestContext = await browser.newContext()

  await seedCompetitiveTeam(hostContext)
  await seedCompetitiveTeam(guestContext)

  const { page: hostPage, unexpectedConsoleErrors: hostConsole, debugConsole: hostDebug } = await openFreshLobby(hostContext)
  const { page: guestPage, unexpectedConsoleErrors: guestConsole, debugConsole: guestDebug } =
    await openFreshLobby(guestContext)

  await prepareCompetitiveQueue(hostPage)
  await prepareCompetitiveQueue(guestPage)

  await Promise.all([waitForRankedMatchedOrBattle(hostPage), waitForRankedMatchedOrBattle(guestPage)])

  // If client auto-redirect succeeds, verify battle page shell.
  if (/\/battle\?roomId=/.test(hostPage.url())) {
    await expect(hostPage.getByRole('button', { name: '战斗', exact: true })).toBeVisible({ timeout: 60_000 })
  }
  if (/\/battle\?roomId=/.test(guestPage.url())) {
    await expect(guestPage.getByRole('button', { name: '战斗', exact: true })).toBeVisible({ timeout: 60_000 })
  }

  expect(hostConsole).toEqual([])
  expect(guestConsole).toEqual([])
  test.info().attach('host-console', { body: hostDebug.join('\n'), contentType: 'text/plain' })
  test.info().attach('guest-console', { body: guestDebug.join('\n'), contentType: 'text/plain' })

  await hostContext.close()
  await guestContext.close()
})
