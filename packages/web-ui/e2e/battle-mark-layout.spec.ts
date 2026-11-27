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

test('marks fill six slots per row in mirrored order and keep that capacity after resize', async ({ page }) => {
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

  for (const count of [5, 6, 7, 12, 13, 40]) {
    await setMarkCount(page, count)
    for (const side of ['left', 'right']) {
      const status = page.locator(`[data-battle-status="${side}"]`)
      const marks = status.locator('.battle-status__marks')
      await expect(marks.locator(':scope > [data-tooltip-parent]')).toHaveCount(count > 12 ? 11 : count)
      await expect(marks.locator('summary')).toHaveCount(count > 12 ? 1 : 0)
      const layout = await marks.evaluate(el => {
        const icons = [...el.querySelectorAll<HTMLElement>(':scope > [data-tooltip-parent]')]
        return {
          columns: icons.slice(0, 6).map(icon => icon.offsetLeft),
          rows: [...new Set(icons.map(icon => icon.offsetTop))],
        }
      })
      expect(layout.columns).toEqual(
        Array.from({ length: Math.min(6, count) }, (_, i) => 32 * (side === 'left' ? i : 5 - i)),
      )
      expect(layout.rows).toEqual(count > 6 ? [0, 34] : [0])
      if (count > 12) {
        await marks.locator('summary').click()
        await expect(marks.locator('details > div > [data-tooltip-parent]')).toHaveCount(count - 11)
        await expect(marks.locator('details > div')).toBeVisible()
        await marks.locator('summary').click()
      }
    }
  }

  await page.setViewportSize({ width: 900, height: 600 })
  for (const side of ['left', 'right']) {
    const marks = page.locator(`[data-battle-status="${side}"] .battle-status__marks`)
    await expect(marks.locator(':scope > [data-tooltip-parent]')).toHaveCount(11)
    await expect(marks.locator('summary')).toHaveText('+29')
  }
})
