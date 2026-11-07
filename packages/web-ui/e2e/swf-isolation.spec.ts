import { expect, test } from 'playwright/test'
import { readFileSync } from 'node:fs'
const playerDocument = readFileSync(new URL('../public/swf-player.html', import.meta.url), 'utf8')
test('compromised player cannot read parent capabilities or make requests', async ({ page }) => {
  const probes: string[] = []
  await page.route('**/swf-boundary-harness', route =>
    route.fulfill({
      contentType: 'text/html',
      headers: { 'content-security-policy': "frame-src 'none'" },
      body: '<div id="private">fixture-secret</div>',
    }),
  )
  await page.route('**/swf-probe**', route => {
    probes.push(route.request().url())
    return route.fulfill({ body: 'probe' })
  })
  await page.goto('/swf-boundary-harness')
  await page.evaluate(doc => {
    localStorage.setItem('fixture-token', 'fake-only')
    ;(window as unknown as Record<string, unknown>).arcadiaDesktop = { secret: 'fake' }
    const frame = document.createElement('iframe')
    frame.sandbox.add('allow-scripts')
    frame.srcdoc = doc
    document.body.append(frame)
  }, playerDocument)
  const frame = page.frames().find(f => f !== page.mainFrame())!
  await frame.waitForLoadState()
  const result = await frame.evaluate(async () => {
    const denied = (fn: () => unknown) => {
      try {
        fn()
        return false
      } catch {
        return true
      }
    }
    const parentDom = denied(() => parent.document.getElementById('private'))
    const storage = denied(() => localStorage.getItem('fixture-token'))
    const bridge = denied(() => (parent as unknown as Record<string, unknown>).arcadiaDesktop)
    const network = await fetch('http://127.0.0.1:4173/swf-probe-fetch').then(
      () => false,
      () => true,
    )
    const image = new Image()
    image.src = 'http://127.0.0.1:4173/swf-probe-image'
    document.body.append(image)
    return { parentDom, storage, bridge, network, popup: window.open('http://127.0.0.1:4173/swf-probe-popup') === null }
  })
  expect(result).toEqual({ parentDom: true, storage: true, bridge: true, network: true, popup: true })
  // A compromised page can choose its own location; the *parent* frame-src policy must deny that request.
  await frame.evaluate(() => {
    setTimeout(() => {
      location.href = 'http://127.0.0.1:4173/swf-probe-navigation'
    }, 0)
  })
  await page.waitForTimeout(300)
  expect(probes).toEqual([])
  expect(await page.locator('#private').textContent()).toBe('fixture-secret')
})

for (const kind of ['form', 'meta', 'blob', 'data'] as const) {
  test(`parent policy denies compromised player ${kind} navigation`, async ({ page }) => {
    const requests: string[] = []
    await page.route('**/swf-boundary-harness', route =>
      route.fulfill({
        contentType: 'text/html',
        headers: { 'content-security-policy': "frame-src 'none'" },
        body: '<div>safe</div>',
      }),
    )
    await page.route('**/swf-probe**', route => {
      requests.push(route.request().url())
      return route.fulfill({ body: 'probe' })
    })
    await page.goto('/swf-boundary-harness')
    await page.evaluate(doc => {
      const frame = document.createElement('iframe')
      frame.sandbox.add('allow-scripts')
      frame.srcdoc = doc
      document.body.append(frame)
    }, playerDocument)
    const frame = page.frames().find(f => f !== page.mainFrame())!
    await frame.waitForLoadState()
    await frame.evaluate(mode => {
      const target = 'http://127.0.0.1:4173/swf-probe-navigation'
      if (mode === 'form') {
        const form = document.createElement('form')
        form.action = target
        document.body.append(form)
        form.submit()
      } else if (mode === 'meta') {
        const meta = document.createElement('meta')
        meta.httpEquiv = 'refresh'
        meta.content = `0;url=${target}`
        document.head.append(meta)
      } else if (mode === 'blob') {
        location.href = URL.createObjectURL(new Blob([`<img src="${target}">`], { type: 'text/html' }))
      } else location.href = `data:text/html,${encodeURIComponent(`<img src="${target}">`)}`
    }, kind)
    await page.waitForTimeout(200)
    expect(requests).toEqual([])
  })
}
