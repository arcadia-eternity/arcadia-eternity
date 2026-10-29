import { expect, test } from 'playwright/test'

async function seedUnresolvedTeam(page: import('playwright/test').Page, missingSpecies = false) {
  await page.addInitScript(
    ({ missingSpecies }) => {
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
        ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
        skills: ['custom:missing-skill', 'skill_qili', 'skill_fenlitupo'],
        ability: 'custom:missing-ability',
        emblem: 'custom:missing-emblem',
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
    { missingSpecies },
  )
}

test('editing recognized skills and saving never removes unresolved references', async ({ page }) => {
  await seedUnresolvedTeam(page)
  await page.goto('/team-builder')
  await page.getByText('保留精灵', { exact: true }).click()
  await expect(page.getByTestId('missing-team-content')).toContainText('custom:missing-skill')
  const skill = page.getByTestId('normal-skill-0')
  await skill.hover()
  await skill.locator('.el-select__clear').click()
  await page.getByPlaceholder('输入精灵名称').fill('仍然保留')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('petStorage')!).teams[0].pets[0].skills))
    .toEqual(['custom:missing-skill', 'skill_fenlitupo'])
  await page.reload()
  await page.getByText('仍然保留', { exact: true }).click()
  await expect(page.getByTestId('missing-team-content')).toContainText('custom:missing-skill')
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('petStorage')!).teams[0].pets[0])
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
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出', exact: true }).click()
  expect((await download).suggestedFilename()).toMatch(/\.yaml$/)
  await page.reload()
  await page.getByText('失联但保留', { exact: true }).click()
  await expect(page.getByTestId('missing-team-content')).toContainText('custom:missing-pet')
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('petStorage')!).teams[0].pets[0])
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
