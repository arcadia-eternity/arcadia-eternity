import { expect, test } from 'playwright/test'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSingleProcessApp } from '../../server/src/standalone/app'
import { createNpmFixture } from '../../server/test/fixtures/npm'

test('a real npm environment renders media and reactive bilingual rich text without prefetch or cache reuse', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const fixture = await createNpmFixture({ presentation: true })
  const server = createSingleProcessApp({ port: 0, host: '127.0.0.1', corsOrigins: ['*'] })
  const harness = fileURLToPath(new URL('../test-results/content-presentation.html', import.meta.url))
  try {
    const environment = await server.environments.prepareNpm(fixture.directory)
    await server.start()
    const serverUrl = `http://127.0.0.1:${server.address!.port}`
    await mkdir(dirname(harness), { recursive: true })
    await writeFile(
      harness,
      `<!doctype html><html><body><div id="app"></div><script type="module">
      import { createApp, h, ref } from 'vue';
      import { createPinia } from 'pinia';
      import i18next from 'i18next';
      import I18NextVue from 'i18next-vue';
      import { serverContentText } from '/src/i18n/serverContent.ts';
      import { prepareServerEnvironment } from '/src/services/serverEnvironment.ts';
      import { useGameDataStore } from '/src/stores/gameData.ts';
      import ContentDescription from '/src/components/ContentDescription.ts';
      import PetIcon from '/src/components/PetIcon.vue';
      import PetSprite from '/src/components/battle/PetSprite.vue';
      await i18next.use(serverContentText).init({ lng: 'zh-CN', resources: {}, postProcess: ['serverContentText'] });
      const prepared = await prepareServerEnvironment(${JSON.stringify(serverUrl)}, ${JSON.stringify(environment)});
      const pinia = createPinia();
      const data = useGameDataStore(pinia); data.applyServerEnvironment(prepared.content);
      const species = data.getSpecies('example-slow:pet');
      const stack = ref(35), show = ref(true);
      createApp({ setup: () => () => h('main', [
        h(ContentDescription, { namespace: 'skill', contentId: 'example-slow:strike', context: { skill: { power: 40 } }, id: 'skill-description' }),
        h(ContentDescription, { namespace: 'mark', contentId: 'example-slow:slow', context: { mark: { stack: stack.value } }, id: 'description' }),
        show.value ? h(PetIcon, { species, id: species.num, style: 'width:64px;height:64px', 'data-testid': 'custom-icon' }) : null,
        h(PetSprite, { num: 0, imageUrl: species.presentation.portrait, uncached: true }),
        h('button', { onClick: () => stack.value = 12 }, 'change stack'),
        h('button', { onClick: () => i18next.changeLanguage('en') }, 'English'),
        h('button', { onClick: () => show.value = !show.value }, 'toggle icon'),
        h('button', { onClick: () => data.clearServerEnvironment() }, 'leave'),
        h('p', { id: 'name' }, i18next.t('example-slow:pet.name', { ns: 'species', nsSeparator: false, defaultValue: 'unloaded' })),
      ]) }).use(pinia).use(I18NextVue, { i18next }).mount('#app');
    </script></body></html>`,
    )
    const mediaRequests: string[] = []
    const swfRequests: string[] = []
    page.on('request', request => {
      if (request.url().includes('/assets/')) mediaRequests.push(request.url())
      if (request.url().includes('not-fetched.swf')) swfRequests.push(request.url())
    })
    await page.goto('/test-results/content-presentation.html')
    await expect(page.locator('#description')).toHaveText('剩余 35 层')
    await expect(page.locator('#name')).toHaveText('展示精灵')
    await expect
      .poll(() =>
        page
          .locator('[data-testid="pet-static-fallback"] img')
          .evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBe(1)
    await expect.poll(() => page.getByTestId('custom-icon').getAttribute('style')).toContain('blob:')
    expect(swfRequests).toEqual([])
    await expect(page.locator('#skill-description')).toContainText('造成 40 点伤害')
    await page.locator('#skill-description').getByText('减速', { exact: true }).hover()
    await expect(page.getByRole('tooltip')).toContainText('减速')
    await page.getByRole('button', { name: 'change stack' }).hover()
    await page.getByRole('button', { name: 'change stack' }).click()
    await expect(page.locator('#description')).toHaveText('剩余 12 层')
    await page.getByRole('button', { name: 'English', exact: true }).click()
    await expect(page.locator('#name')).toHaveText('Display pet')
    const before = mediaRequests.length
    await page.getByRole('button', { name: 'toggle icon' }).click()
    await expect(page.getByTestId('custom-icon')).toHaveCount(0)
    await page.getByRole('button', { name: 'toggle icon' }).click()
    await expect.poll(() => mediaRequests.length).toBeGreaterThan(before)
    await page.getByRole('button', { name: 'leave', exact: true }).click()
    await expect(page.locator('#name')).toHaveText('unloaded')
    await expect(page.locator('#description')).toBeEmpty()
  } finally {
    await server.stop()
    await fixture.dispose()
    await rm(harness, { force: true })
  }
})
