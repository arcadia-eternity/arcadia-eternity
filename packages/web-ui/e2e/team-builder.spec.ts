import { readPersistedProfile, readPersistedTeam } from './helpers/profile'
import { expect, test } from 'playwright/test'

async function seedUnresolvedTeam(
  page: import('playwright/test').Page,
  missingSpecies = false,
  inheritance = false,
  hp = 31,
) {
  await page.addInitScript(
    ({ missingSpecies, inheritance, hp }) => {
      if (localStorage.getItem('missing-content-seeded')) return
      localStorage.setItem('missing-content-seeded', '1')
      const pet = {
        id: 'a'.repeat(21),
        name: '保留精灵',
        species: missingSpecies ? 'custom:missing-pet' : 'pet_xiuluosi',
        level: 100,
        nature: 'Jolly',
        gender: 'Female',
        evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
        ivs: { hp, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
        skills: ['custom:missing-skill', 'skill_qili', 'skill_fenlitupo'],
        ability: 'custom:missing-ability',
        emblem: 'custom:missing-emblem',
      }
      if (inheritance) {
        Object.assign(pet, {
          species: 'pet_heyimi',
          name: '荷依米',
          skills: ['skill_kusechouda'],
          ability: 'mark_ability_ganjue',
          emblem: 'mark_emblem_tingjue',
        })
      }
      localStorage.setItem(
        'petStorage',
        JSON.stringify({
          storage: [],
          teams: [{ name: '缺失内容队伍', pets: [pet], ruleSetId: 'casual_standard_ruleset' }],
          currentTeamIndex: 0,
          lastMatchingConfig: null,
        }),
      )
    },
    { missingSpecies, inheritance, hp },
  )
}

test('editing recognized skills and saving never removes unresolved references', async ({ page }) => {
  await seedUnresolvedTeam(page)
  await page.goto('/team-builder')
  await page.getByText('保留精灵', { exact: true }).click()
  await expect(page.getByTestId('missing-team-content')).toContainText('custom:missing-skill')
  await expect(page.getByRole('heading', { name: '能力值配置' })).toBeVisible()
  await expect(page.getByTestId('normal-skill-0')).toBeVisible()
  await expect(page.getByRole('tab', { name: /配招|养成/ })).toHaveCount(0)
  await expect(page.getByText('单宠预设', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '试算养成' })).toHaveCount(0)
  const skill = page.getByTestId('normal-skill-0')
  await skill.hover()
  await skill.locator('.el-select__clear').click()
  await page.getByPlaceholder('输入精灵名称').fill('仍然保留')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect
    .poll(async () => (await readPersistedTeam(page))?.[0]?.skills)
    .toEqual(['custom:missing-skill', 'skill_fenlitupo'])
  await page.reload()
  await page.getByText('仍然保留', { exact: true }).click()
  await expect(page.getByTestId('missing-team-content')).toContainText('custom:missing-skill')
  const saved = (await readPersistedTeam(page))![0]
  expect(saved.ability).toBe('custom:missing-ability')
  expect(saved.emblem).toBe('custom:missing-emblem')
  expect(saved.gender).toBe('Female')
})

test('a missing species remains editable, exportable and saved with its original configuration', async ({ page }) => {
  await seedUnresolvedTeam(page, true)
  await page.goto('/team-builder')
  await page.getByText('保留精灵', { exact: true }).click()
  await expect(page.getByTestId('missing-team-content')).toContainText('custom:missing-pet')
  await page.getByPlaceholder('输入精灵名称').fill('失联但保留')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect.poll(async () => (await readPersistedTeam(page))?.[0]?.name).toBe('失联但保留')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出', exact: true }).click()
  expect((await download).suggestedFilename()).toMatch(/\.yaml$/)
  await page.reload()
  await page.getByText('失联但保留', { exact: true }).click()
  await expect(page.getByTestId('missing-team-content')).toContainText('custom:missing-pet')
  const saved = (await readPersistedTeam(page))![0]
  expect(saved.species).toBe('custom:missing-pet')
  expect(saved.skills).toEqual(['custom:missing-skill', 'skill_qili', 'skill_fenlitupo'])
})

test('the editor opens and saves while the animation runtime is still loading', async ({ page }) => {
  let release!: () => void
  const pendingRuntime = new Promise<void>(resolve => {
    release = resolve
  })
  await page.route('**/ruffle/ruffle.js*', async route => {
    await pendingRuntime
    await route.continue()
  })
  try {
    await page.goto('/team-builder', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: '队伍编辑器', exact: true })).toBeVisible({ timeout: 5000 })
    await page.getByText('休罗斯', { exact: true }).first().click()
    await page.getByPlaceholder('输入精灵名称').fill('白屏修复测试')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(async () => (await readPersistedTeam(page))?.[0]?.name).toBe('白屏修复测试')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByText('白屏修复测试', { exact: true }).click()
    await expect(page.getByPlaceholder('输入精灵名称')).toHaveValue('白屏修复测试')
  } finally {
    release()
    await page.unrouteAll({ behavior: 'wait' })
  }
})

test('navigation keeps the editor in the viewport from its first rendered frame', async ({ page }) => {
  await page.goto('/storage')
  await expect(page.getByRole('heading', { name: '精灵仓库', exact: true }).first()).toBeVisible()
  const position = await page.evaluate(async () => {
    const button = [...document.querySelectorAll('button')].find(el => el.textContent?.trim() === '队伍编辑')!
    button.click()
    for (let frame = 0; frame < 30; frame++) {
      await new Promise(requestAnimationFrame)
      const heading = [...document.querySelectorAll('h1, h2')].find(el =>
        ['队伍编辑器', '正在初始化队伍编辑器'].includes(el.textContent?.trim() ?? ''),
      )
      if (heading) return { top: heading.getBoundingClientRect().top, viewport: window.innerHeight }
    }
    throw new Error('队伍编辑器未渲染')
  })
  expect(position.top).toBeLessThan(position.viewport)
})

test('shows the member identifier without team usage or replacement controls', async ({ page }) => {
  await seedUnresolvedTeam(page)
  await page.goto('/team-builder')
  const header = page.locator('.el-card__header').filter({ has: page.getByRole('heading', { name: '基础信息' }) })
  await expect(header).toContainText('#aaaaaaaa')
  await expect(header.getByRole('button', { name: /使用队伍/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '更换精灵', exact: true })).toHaveCount(0)
})

test('updates training stats and persists direct edits', async ({ page }) => {
  await seedUnresolvedTeam(page)
  await page.goto('/team-builder')
  const iv = page.getByRole('spinbutton', { name: '体力个体值' })
  const hp = page.getByLabel('体力最终值', { exact: true })
  const before = Number(await hp.innerText())
  await iv.fill('')
  await iv.blur()
  await expect(iv).toHaveValue('31')
  await iv.fill('')
  await iv.pressSequentially('17')
  await expect(iv).toHaveValue('17')
  await expect(hp).toHaveText(String(before - 14))
  await page.getByLabel('体力计算明细').click()
  await expect(page.getByText(/等级折算/).first()).toContainText('+ 17')
  await expect.poll(async () => (await readPersistedTeam(page))?.[0]?.ivs.hp).toBe(17)
  expect((await readPersistedTeam(page))?.[0]?.skills).toContain('custom:missing-skill')
})

for (const scope of ['copy', 'original'] as const) {
  test(`saves a direct training edit to a shared member using the ${scope} save scope`, async ({ page }) => {
    await seedUnresolvedTeam(page)
    await page.goto('/storage')
    await page.getByRole('button', { name: '复制', exact: true }).first().click()
    await expect.poll(async () => (await readPersistedProfile(page))?.library.teams.length).toBe(2)
    await page.goto('/team-builder')
    await page.getByRole('spinbutton', { name: '体力个体值' }).fill('20')
    const apply = page.getByRole('button', {
      name: scope === 'copy' ? '复制一只给本队' : '修改原精灵',
      exact: true,
    })
    await expect(page.getByText('修改原精灵会同步到：缺失内容队伍', { exact: true })).toBeVisible()
    await expect(apply).toBeVisible()
    expect((await readPersistedTeam(page, 1))?.[0]?.ivs.hp).toBe(31)
    await apply.click()
    await expect.poll(async () => (await readPersistedTeam(page, 1))?.[0]?.ivs.hp).toBe(20)
    expect((await readPersistedTeam(page, 0))?.[0]?.ivs.hp).toBe(scope === 'copy' ? 31 : 20)
    const teams = (await readPersistedProfile(page))!.library.teams
    expect(teams[0].memberIds[0] === teams[1].memberIds[0]).toBe(scope === 'original')
  })
}

test('confirms and undoes all changes to a member when switching species', async ({ page }) => {
  await seedUnresolvedTeam(page)
  await page.goto('/team-builder')
  await page.getByText('保留精灵', { exact: true }).click()
  const original = (await readPersistedTeam(page))![0]
  const select = page.locator('[data-team-field="species"]')
  const chooseSpecies = async () => {
    await select.click()
    await select.getByRole('combobox').fill('迪兰')
    await page
      .getByRole('option')
      .filter({ has: page.getByText('迪兰', { exact: true }) })
      .click()
  }
  const dialog = page.getByRole('dialog', { name: '更换种族', exact: true })
  await chooseSpecies()
  await expect(dialog).toContainText('custom:missing-skill')
  await dialog.getByRole('button', { name: '取消' }).click()
  await expect(dialog).toBeHidden()
  expect((await readPersistedTeam(page))![0]).toEqual(original)
  await chooseSpecies()
  await page.getByRole('button', { name: '确认更换种族' }).click()
  await expect.poll(async () => (await readPersistedTeam(page))![0].species).toBe('pet_dilan')
  await page.getByRole('button', { name: '撤销更换种族' }).click()
  await expect.poll(async () => (await readPersistedTeam(page))![0]).toEqual(original)
})

test('equips, replaces and clears an inherited move from the same skill slot', async ({ page }) => {
  await seedUnresolvedTeam(page, false, true)
  await page.goto('/team-builder')
  const second = page.getByRole('combobox', { name: '普通技能 2', exact: true })
  const third = page.getByRole('combobox', { name: '普通技能 3', exact: true })
  const option = (name: string) => page.getByRole('option').filter({ hasText: name })
  await second.fill('毒针连射')
  await option('毒针连射').click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect.poll(async () => (await readPersistedTeam(page))?.[0]?.inheritedSkill).toBe('skill_duzhenlianshe')
  await page.reload()
  await expect(page.getByTestId('normal-skill-1')).toContainText('毒针连射')
  await third.fill('金针射击')
  await expect(option('金针射击')).toBeDisabled()
  await third.press('Escape')
  await second.fill('金针射击')
  await option('金针射击').click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect.poll(async () => (await readPersistedTeam(page))?.[0]?.inheritedSkill).toBe('skill_jinzhensheji')
  await page.getByTestId('normal-skill-1').hover()
  await page.getByTestId('normal-skill-1').locator('.el-select__clear').click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect.poll(async () => (await readPersistedTeam(page))?.[0]?.skills).toEqual(['skill_kusechouda'])
  expect((await readPersistedTeam(page))![0]?.inheritedSkill).toBeUndefined()
})

test('keeps a shared move draft on warehouse visits and team switches until explicitly discarded', async ({ page }) => {
  await seedUnresolvedTeam(page, false, true)
  await page.goto('/storage')
  await page.getByRole('button', { name: '复制', exact: true }).first().click()
  await expect.poll(async () => (await readPersistedProfile(page))?.library.teams.length).toBe(2)
  await page.goto('/team-builder')
  await page.getByRole('combobox', { name: '普通技能 2', exact: true }).fill('毒针连射')
  await page.getByRole('option').filter({ hasText: '毒针连射' }).click()
  const copy = page.getByRole('button', { name: '复制一只给本队', exact: true })
  const warehouse = page.getByRole('link', { name: '仓库管理', exact: true })
  const slot = page.getByTestId('normal-skill-1')
  await expect(copy).toBeVisible()
  await warehouse.click()
  await page.goBack()
  await expect(slot).toContainText('毒针连射')
  for (const other of [true, false]) {
    await warehouse.click()
    await page.getByRole('button', { name: '设为当前', exact: true }).and(page.locator(':enabled')).click()
    await page.goBack()
    if (other) await expect(slot).not.toContainText('毒针连射')
    else await expect(slot).toContainText('毒针连射')
  }
  expect((await readPersistedTeam(page, 1))![0].inheritedSkill).toBeUndefined()
  const discard = page.getByRole('button', { name: '放弃草稿', exact: true })
  await discard.click()
  await page.getByRole('button', { name: '继续编辑' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(slot).toContainText('毒针连射')
  await discard.click()
  await page.getByRole('dialog').getByRole('button', { name: '放弃草稿' }).click()
  await expect(slot).not.toContainText('毒针连射')
  await expect(copy).toHaveCount(0)
})

test('opens the offending field directly from a single IV violation', async ({ page }) => {
  await seedUnresolvedTeam(page, false, true, 120)
  await page.goto('/team-builder')
  const issue = page.getByRole('button', { name: /荷依米 的体力资质 120 超过当前环境上限 31/ })
  await expect(issue).toBeVisible()
  await expect(page.getByRole('button', { name: /详情/ })).toHaveCount(0)
  await issue.click()
  const hp = page.getByRole('spinbutton', { name: '体力个体值' })
  await expect(hp).toBeFocused()
  await expect(hp).toHaveValue('120')
})

test('blocks a parked draft from overwriting a newer shared warehouse member', async ({ page }) => {
  await seedUnresolvedTeam(page, false, true)
  await page.goto('/storage')
  await page.getByRole('button', { name: '复制', exact: true }).first().click()
  await expect.poll(async () => (await readPersistedProfile(page))?.library.teams.length).toBe(2)
  await page.goto('/team-builder')
  const nickname = page.getByPlaceholder('输入精灵名称')
  const switchTeam = async () => {
    await page.getByRole('link', { name: '仓库管理' }).click()
    await page.getByRole('button', { name: '设为当前', exact: true }).and(page.locator(':enabled')).click()
    await page.goBack()
  }
  await nickname.fill('副队配法')
  await switchTeam()
  await expect(nickname).toHaveValue('荷依米')
  await nickname.fill('新仓库配法')
  await page.getByRole('button', { name: '修改原精灵', exact: true }).click()
  await expect.poll(async () => (await readPersistedTeam(page, 0))?.[0].name).toBe('新仓库配法')
  await switchTeam()
  await expect(nickname).toHaveValue('副队配法')
  await expect(page.getByRole('button', { name: '修改原精灵', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '放弃草稿', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '放弃草稿', exact: true }).click()
  await expect(nickname).toHaveValue('新仓库配法')
})

test('keeps the active environment through warehouse visits and releases a superseded selection', async ({ page }) => {
  let started = 0
  let unavailable = false
  const releases: string[] = []
  let finish!: () => void
  const pending = new Promise<void>(resolve => {
    finish = resolve
  })
  await page.exposeFunction('captureTeamTestEnvironment', async (id: string) => {
    started++
    if (unavailable) throw new Error('环境暂不可用')
    if (id === 'slow') await pending
    return { token: id, content: { species: [], skills: [], marks: [] } }
  })
  await page.exposeFunction('releaseTeamTestEnvironment', (id: string) => {
    releases.push(id)
  })
  await page.goto('/')
  const editorLink = page.getByRole('link', { name: '队伍编辑', exact: true }).last()
  await editorLink.click()
  await expect(page.getByRole('heading', { name: '基础信息' })).toBeVisible()
  await page.goBack()
  await page.evaluate(() => {
    const bridge = window as unknown as Record<string, unknown>
    Object.defineProperty(window, 'arcadiaDesktop', {
      configurable: true,
      value: {
        localEnvironment: async () => ({
          result: {
            workspaceId: 'test',
            installations: ['slow', 'fast'].map(id => ({
              status: 'ready',
              document: { name: id },
              environmentId: id,
              draftRevision: '1',
              contentRevision: id,
            })),
          },
        }),
        prepareLocalContent: bridge.captureTeamTestEnvironment,
        releaseLocalContent: bridge.releaseTeamTestEnvironment,
      },
    })
  })
  await editorLink.click()
  const environment = page.getByRole('combobox', { name: '对战环境', exact: true })
  const choose = async (name: string) => {
    await page.locator('.el-select').filter({ has: environment }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('option', { name, exact: true }).click()
  }
  await expect(page.locator('.el-card__header').filter({ hasText: '当前队伍' }).getByRole('combobox')).toBeVisible()
  await choose('slow')
  await expect(page.getByRole('status', { name: '正在切换环境' })).toBeVisible()
  await expect(page.getByPlaceholder('输入精灵名称')).toBeVisible()
  await expect(page.getByRole('button', { name: '导出队伍', exact: true })).toHaveCount(0)
  await choose('fast')
  finish()
  await expect.poll(() => releases).toEqual(['slow'])
  await page.getByRole('link', { name: '仓库管理' }).click()
  await expect(page.getByRole('heading', { name: '精灵仓库' }).first()).toBeVisible()
  await expect(page.locator('.environment-field').filter({ has: environment })).toContainText('fast')
  await page.getByRole('button', { name: '仓库管理', exact: true }).click()
  await expect(
    page
      .locator('div.border-b')
      .filter({ has: page.getByRole('heading', { name: '当前队伍' }) })
      .getByRole('combobox'),
  ).toBeVisible()
  await page.goBack()
  await expect(environment).toBeVisible()
  expect(started).toBe(2)
  expect(releases).toEqual(['slow'])
  await choose('本机当前环境')
  await expect.poll(() => releases).toEqual(['slow', 'fast'])
  expect(started).toBe(2)

  unavailable = true
  await choose('fast')
  await expect(page.getByRole('alert').filter({ hasText: '环境暂不可用' })).toBeVisible()
  await expect(page.getByRole('button', { name: '导出队伍', exact: true })).toBeVisible()
  unavailable = false
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.getByRole('heading', { name: '基础信息' })).toBeVisible()
  expect(started).toBe(4)
})
