import { readPersistedTeam } from './helpers/profile'
import { expect, test, type BrowserContext, type Page } from 'playwright/test'

async function useStaticRules(page: Page, rules: import('@arcadia-eternity/protocol').EnvironmentRules) {
  await page.route('**/environment/catalog.json', async route => {
    const response = await route.fetch()
    const catalog = await response.json()
    const { digestJson, environmentVersion } = await import('@arcadia-eternity/pack-loader/native')
    const gameplayRevision = await digestJson({
      runtime: catalog.runtimeIdentity,
      material: catalog.runtimeRevision,
      rules,
    })
    await route.fulfill({
      response,
      json: {
        ...catalog,
        rules,
        gameplayRevision,
        environmentVersion: environmentVersion(gameplayRevision, catalog.presentationRevision),
      },
    })
  })
}

const localPage = './#/local-battle'

async function observeStaticOnly(context: BrowserContext, page: Page, baseURL: string) {
  const forbiddenRequests: string[] = []
  const errors: string[] = []
  const origin = new URL(baseURL).origin
  const prefix = new URL(baseURL).pathname
  const forbidden = (url: string) => {
    const parsed = new URL(url)
    return (
      /^https?:$/.test(parsed.protocol) &&
      (parsed.origin !== origin ||
        !parsed.pathname.startsWith(prefix) ||
        /\/(api|socket\.io)(\/|$)/.test(parsed.pathname))
    )
  }
  context.on('request', request => {
    if (forbidden(request.url())) forbiddenRequests.push(request.url())
  })
  await context.route('**/*', route =>
    forbidden(route.request().url()) ? route.abort('blockedbyclient') : route.continue(),
  )
  await page.routeWebSocket(/.*/, socket => {
    forbiddenRequests.push(socket.url())
    socket.close()
  })
  page.on('pageerror', error => errors.push(error.message))
  return { forbiddenRequests, errors }
}

async function configureSinglePetBattle(page: Page) {
  await expect(page.getByRole('button', { name: '开始本地对战', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '团队选择测试', exact: true }).click()
  await page.getByRole('spinbutton', { name: '最多出战数量', exact: true }).fill('1')

  await page.getByPlaceholder('留空使用随机种子').fill('208')
}

async function enterBattle(page: Page) {
  await page.getByRole('button', { name: '开始本地对战', exact: true }).click()
  await expect(page).toHaveURL(/#\/battle\?/)
  const team = page.getByRole('heading', { name: '完整队伍', exact: true }).locator('..')
  await team.getByText('休罗斯', { exact: true }).click()
  await page.getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.getByTestId('battle-command-dock')).toBeVisible()
  await expect(page.getByText('对战开始！', { exact: true })).toBeVisible()
  await page.getByLabel('动效模式', { exact: true }).selectOption('reduced')
}

async function attackUntilResult(page: Page) {
  const result = page.locator('.battle-result')
  // The default starter has four damage moves and one status move. Use only
  // the real, enabled damage buttons; do not manipulate the battle engine.
  const attacks = page.locator('[data-testid="skill-button"]:enabled:not([data-skill-base-id="skill_qili"])')
  let turns = 0
  while (!(await result.isVisible()) && turns < 40) {
    await expect(result.or(attacks.first()).first()).toBeVisible()
    if (await result.isVisible()) break
    const button = attacks.first()
    const id = await button.getAttribute('data-skill-base-id')
    await button.click()
    turns++
    await expect(page.locator(`[data-skill-base-id="${id}"]`)).toBeDisabled()
  }
  await expect(result).toBeVisible()
  await expect(result.getByRole('heading')).toHaveText(/胜利！|失败\.\.\.|平局/)
  expect(turns).toBeGreaterThan(0)
  return turns
}

test('a new player completes a production AI match and starts another without any backend', async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  const observed = await observeStaticOnly(context, page, baseURL!)
  await useStaticRules(page, { schemaVersion: 2, mechanics: { allowFaintSwitch: false } })
  await page.goto('./')
  await expect(page).toHaveURL(/#\/local-battle$/)
  // The environment controls the knockout reward throughout both battles.
  await configureSinglePetBattle(page)
  await enterBattle(page)
  const turns = await attackUntilResult(page)
  const screenshot = testInfo.outputPath('natural-result.png')
  await page.screenshot({ path: screenshot })
  await testInfo.attach('static-natural-result', { path: screenshot, contentType: 'image/png' })
  await page
    .getByRole('button', { name: /再来一局|重新对战|重新开始|返回本地对战/ })
    .first()
    .click()
  await expect(page).toHaveURL(/#\/local-battle/)
  await configureSinglePetBattle(page)
  await enterBattle(page)
  await expect(page.locator('[data-skill-base-id="skill_fenlitupo"]')).toBeEnabled()
  expect(observed.forbiddenRequests).toEqual([])
  expect(observed.errors).toEqual([])
  await testInfo.attach('static-network-and-result', {
    body: JSON.stringify({ turns, ...observed }, null, 2),
    contentType: 'application/json',
  })
})

test('saved static resources reload offline and run another local battle', async ({ page, context, baseURL }) => {
  const observed = await observeStaticOnly(context, page, baseURL!)
  await page.goto(localPage)
  await page.getByRole('button', { name: '保存离线资源', exact: true }).click()
  await expect(page.getByText('离线资源已就绪', { exact: true })).toBeVisible({ timeout: 120_000 })
  await context.setOffline(true)
  await page.reload()
  await configureSinglePetBattle(page)
  await enterBattle(page)
  await page.locator('[data-skill-base-id="skill_fenlitupo"]').click()
  await expect(
    page
      .getByRole('log', { name: '战斗记录' })
      .getByText(/休罗斯 使用 奋力突破/)
      .last(),
  ).toBeVisible()
  expect(observed.forbiddenRequests).toEqual([])
  expect(observed.errors).toEqual([])
})

test('a cache quota failure is visible and does not block a local battle', async ({ page, context, baseURL }) => {
  const observed = await observeStaticOnly(context, page, baseURL!)
  await page.addInitScript(() => {
    Cache.prototype.put = async () => {
      throw new DOMException('Test storage quota exceeded', 'QuotaExceededError')
    }
  })
  await page.goto(localPage)
  await page.getByRole('button', { name: '保存离线资源', exact: true }).click()
  await expect(page.getByText(/离线资源.*失败|空间不足/)).toBeVisible()
  await expect(page.getByText('离线资源已就绪', { exact: true })).toHaveCount(0)
  await configureSinglePetBattle(page)
  await enterBattle(page)
  await expect(page.locator('[data-skill-base-id="skill_fenlitupo"]')).toBeEnabled()
  expect(observed.forbiddenRequests).toEqual([])
  expect(observed.errors).toEqual([])
})

for (const blockedAccess of ['methods', 'object'] as const) {
  test(`blocked browser storage ${blockedAccess} offers an explicit temporary profile with the default playable team`, async ({
    page,
    context,
    baseURL,
  }) => {
    const observed = await observeStaticOnly(context, page, baseURL!)
    await page.addInitScript(access => {
      const denied = () => {
        throw new DOMException('Test storage access denied', 'SecurityError')
      }
      if (access === 'object') Object.defineProperty(window, 'localStorage', { configurable: true, get: denied })
      else {
        Storage.prototype.getItem = denied
        Storage.prototype.setItem = denied
      }
    }, blockedAccess)
    await page.goto(localPage)
    await page.getByRole('alert').getByRole('link', { name: '查看个人资料', exact: true }).click()
    await expect(page.getByRole('status', { name: '个人资料状态' })).toHaveText('需要恢复')
    await page.getByRole('button', { name: '临时使用', exact: true }).click()
    await expect(page.getByRole('status', { name: '个人资料状态' })).toHaveText('仅本次窗口')
    await page.getByRole('button', { name: '人机对战', exact: true }).click()
    await configureSinglePetBattle(page)
    await enterBattle(page)
    await expect(page.locator('[data-skill-base-id="skill_fenlitupo"]')).toBeEnabled()
    expect(observed.forbiddenRequests).toEqual([])
    expect(observed.errors).toEqual([])
  })
}

test('environment team selection opens before battle and keeps the starter selectable', async ({ page }) => {
  await useStaticRules(page, {
    schemaVersion: 2,
    mechanics: {
      timer: { enabled: true, turnTimeLimit: 90, totalTimeLimit: 0 },
      teamSelection: { enabled: true, maxTeamSize: 1, timeLimit: 0 },
    },
  })
  await page.goto(localPage)
  await expect(page.getByRole('button', { name: '开始本地对战', exact: true })).toBeEnabled()
  await expect(page.getByText('启用计时器系统', { exact: true })).toHaveCount(0)
  await expect(page.getByText('启用团队选择', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '开始本地对战', exact: true }).click()
  const team = page.getByRole('heading', { name: '完整队伍', exact: true }).locator('..')
  await expect(team).toBeVisible()
  const rosterPet = page.locator('.battle-roster--left').getByRole('button', { name: '休罗斯', exact: true })
  // Model an enter event queued while the loading/team overlay was taking control.
  await rosterPet.locator('..').dispatchEvent('mouseenter')
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await team.getByText('休罗斯', { exact: true }).click()
  await page.getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.getByTestId('battle-command-dock')).toBeVisible()
  await rosterPet.hover()
  await expect(page.getByRole('tooltip').first()).toContainText('休罗斯')
})

test('a missing bundled runtime shows a recoverable startup error without using a remote fallback', async ({
  page,
  context,
  baseURL,
}) => {
  const observed = await observeStaticOnly(context, page, baseURL!)
  await page.route('**/ruffle/ruffle.js*', route => route.abort())
  await page.goto(localPage)
  await expect(page.getByRole('alert').getByRole('heading', { name: '无法启动本地对战' })).toBeVisible()
  await expect(page.getByRole('button', { name: '刷新重试', exact: true })).toBeVisible()
  expect(observed.forbiddenRequests).toEqual([])
  expect(observed.errors).toEqual([])
  await page.unroute('**/ruffle/ruffle.js*')
  await page.getByRole('button', { name: '刷新重试', exact: true }).click()
  await expect(page.getByRole('button', { name: '开始本地对战', exact: true })).toBeEnabled()
})

test('a smaller published slot limit keeps overflow equipped until the player removes it', async ({ page }) => {
  await useStaticRules(page, { schemaVersion: 2, mechanics: { skillSlots: { normalMax: 1, climaxMax: 2 } } })
  await page.addInitScript(() => {
    localStorage.setItem(
      'petStorage',
      JSON.stringify({
        storage: [],
        currentTeamIndex: 0,
        teams: [
          {
            name: '槽位队伍',
            pets: [
              {
                id: 's'.repeat(21),
                name: '保留技能',
                species: 'pet_xiuluosi',
                level: 100,
                nature: 'Jolly',
                gender: 'Female',
                ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
                evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
                skills: ['skill_qili', 'skill_fenlitupo'],
              },
            ],
          },
        ],
      }),
    )
  })
  await page.goto('./#/team-builder')
  await page.getByText('保留技能', { exact: true }).click()
  await expect(page.getByRole('combobox', { name: '普通技能 2', exact: true })).toBeVisible()
  await expect(page.getByText('超出槽位', { exact: true })).toBeVisible()
  const extra = page.getByTestId('normal-skill-1')
  await extra.hover()
  await extra.locator('.el-select__clear').click()
  await expect(extra).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: /^普通技能 \d+$/ })).toHaveCount(1)
  await expect(page.getByTestId('normal-skill-0')).toContainText('气力')
  await expect(page.getByText('必杀技能 2', { exact: true })).toBeVisible()
})

test('the web team editor selects shipped environments without a server and restores the team selection', async ({
  context,
  page,
  baseURL,
}) => {
  const { errors, forbiddenRequests } = await observeStaticOnly(context, page, baseURL!)
  await page.goto('./#/team-builder')
  const picker = page
    .locator('.el-select')
    .filter({ has: page.getByRole('combobox', { name: '对战环境', exact: true }) })
  const iv = page.getByRole('spinbutton', { name: '体力个体值' })
  await page.locator('.team-member').first().click()
  await expect(iv).toHaveValue('31')
  const baseHp = await page.getByLabel('体力最终值', { exact: true }).innerText()
  const attack = page.getByRole('spinbutton', { name: '攻击个体值', exact: true })
  const speed = page.getByRole('spinbutton', { name: '速度个体值', exact: true })
  await attack.fill('15')
  await attack.blur()
  await speed.fill('0')
  await speed.blur()
  await picker.click()
  await expect(page.getByRole('option', { name: '默认环境', exact: true })).toBeVisible()
  await page.getByRole('option', { name: '120 资质 · 神魔化与二代', exact: true }).click()
  await expect(iv).toHaveValue('120')
  await expect(attack).toHaveValue('58')
  await expect(speed).toHaveValue('0')
  const defense = page.getByRole('spinbutton', { name: '防御个体值', exact: true })
  await defense.fill('59')
  await defense.blur()
  const stage = page.locator('[data-team-field="enhancement"]')
  const level = page.getByRole('spinbutton', { name: '等级', exact: true })
  await level.fill('99')
  await level.blur()
  await expect(stage).toHaveCount(0)
  await level.fill('100')
  await level.blur()
  const hp = page.getByLabel('体力最终值', { exact: true })
  const startingHp = Number(await hp.innerText())
  await stage.click()
  await expect(page.getByRole('option', { name: '魔化一星', exact: true })).toBeVisible()
  await page.getByRole('option', { name: '神化一星', exact: true }).click()
  await expect(hp).toHaveText(String(startingHp + 30))
  await expect.poll(async () => (await readPersistedTeam(page))?.[0]?.enhancement).toBe('base:evolve-1')
  await page.reload()
  await page.locator('.team-member').first().click()
  await expect(iv).toHaveValue('120')
  await expect(attack).toHaveValue('58')
  await expect(speed).toHaveValue('0')
  await expect(defense).toHaveValue('59')
  await expect(stage).toContainText('神化一星')
  await picker.click()
  await page.getByRole('option', { name: '默认环境', exact: true }).click()
  await expect(iv).toHaveAttribute('max', '31')
  await expect(stage).toContainText('本局不生效')
  await expect(iv).toHaveValue('31')
  await expect(attack).toHaveValue('15')
  await expect(speed).toHaveValue('0')
  await expect(hp).toHaveText(baseHp)
  await expect(defense).toHaveValue('15')
  await picker.click()
  await page.getByRole('option', { name: '120 资质 · 神魔化与二代', exact: true }).click()
  await expect(defense).toHaveValue('59')
  await page.goto('./#/environments')
  const builtins = page.getByRole('navigation', { name: '选择环境' })
  await expect(builtins.getByRole('button')).toHaveCount(2)
  await builtins.getByRole('button', { name: /120 资质/ }).click()
  await expect(page.getByRole('article', { name: '网页内置环境详情' })).toContainText(
    '@arcadia-eternity/data-pack-base',
  )
  expect(errors).toEqual([])
  expect(forbiddenRequests.filter(url => /\/(?:api|socket\.io)\//.test(url))).toEqual([])
})
