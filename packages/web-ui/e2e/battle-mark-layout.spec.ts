import { expect, test, type Page } from 'playwright/test'

async function setMarkCount(page: Page, count: number) {
  await page.evaluate(async count => {
    const modulePath = '/src/stores/battle.ts'
    const { useBattleStore } = await import(/* @vite-ignore */ modulePath)
    const store = useBattleStore()
    for (const player of store.battleState.players) {
      const pet = store.getPetById(player.activePet)
      const base = pet.marks[0] ?? {
        baseId: 'mark_qili',
        stack: 1,
        duration: 3,
        config: { persistent: false, stackable: false },
      }
      pet.marks = Array.from({ length: count }, (_, index) => ({
        ...base,
        id: `layout-${player.id}-${index}`,
      }))
    }
  }, count)
}

test('marks fill two rows across the health bar before collapsing, including after resize', async ({ page }) => {
  test.setTimeout(60000)
  await page.addInitScript(() => localStorage.setItem('gameSetting.battleRenderer', '"image"'))
  await page.route(/seer2-resource\.yuuinih\.com\/png\//, route =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6G9sAAAAASUVORK5CYII=',
        'base64',
      ),
    }),
  )
  await page.goto('/local-battle')
  await page.getByRole('button', { name: '开始本地对战', exact: true }).click()
  await page.waitForURL(/\/battle\?dev=true/)
  await expect(page.getByTestId('battle-loading-overlay')).toHaveCount(0, { timeout: 30000 })

  for (const count of [5, 20, 26, 27, 40]) {
    await setMarkCount(page, count)
    for (const side of ['left', 'right']) {
      const status = page.locator(`[data-battle-status="${side}"]`)
      const marks = status.locator('.battle-status__marks')
      await expect(marks.locator(':scope > [data-tooltip-parent]')).toHaveCount(count > 26 ? 25 : count)
      await expect(marks.locator('summary')).toHaveCount(count > 26 ? 1 : 0)
      const layout = await status.evaluate(el => {
        const marks = el.querySelector('.battle-status__marks') as HTMLElement
        const bars = el.querySelector('.battle-bars') as HTMLElement
        const icons = [...marks.querySelectorAll(':scope > [data-tooltip-parent]')]
        return {
          width: marks.offsetWidth,
          barWidth: bars.offsetWidth,
          height: marks.offsetHeight,
          rows: new Set(icons.map(icon => Math.round(icon.getBoundingClientRect().top))).size,
        }
      })
      expect(layout.width).toBe(layout.barWidth)
      expect(layout.height).toBe(76)
      expect(layout.rows).toBe(count > 13 ? 2 : 1)
      if (count > 26) {
        await marks.locator('summary').click()
        await expect(marks.locator('details > div > [data-tooltip-parent]')).toHaveCount(count - 25)
        await expect(marks.locator('details > div')).toBeVisible()
        await marks.locator('summary').click()
      }
    }
  }

  // Resize the HUD itself: viewport changes only scale the fixed battle canvas.
  await page.locator('[data-battle-status]').evaluateAll(elements => {
    elements.forEach(el => ((el as HTMLElement).style.width = '360px'))
  })
  for (const side of ['left', 'right']) {
    const marks = page.locator(`[data-battle-status="${side}"] .battle-status__marks`)
    await expect(marks.locator(':scope > [data-tooltip-parent]')).toHaveCount(11)
    await expect(marks.locator('summary')).toHaveText('+29')
  }
})
