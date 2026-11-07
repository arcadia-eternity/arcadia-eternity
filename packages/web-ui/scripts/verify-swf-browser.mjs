/** Run against the local Vite dev server. No account or battle credentials required. */
import { chromium } from 'playwright'
import { writeFile } from 'node:fs/promises'
const base = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4173'
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROME_CHANNEL === 'chrome' ? { channel: 'chrome' } : {}),
})
try {
  const page = await browser.newPage()
  await page.addInitScript(() => {
    window.audioContexts = []
    window.audioStarts = 0
    const NativeContext = window.AudioContext
    window.AudioContext = class extends NativeContext {
      constructor(...args) {
        super(...args)
        window.audioContexts.push(this)
      }
      createBufferSource() {
        const source = super.createBufferSource()
        const start = source.start.bind(source)
        source.start = (...args) => {
          window.audioStarts++
          return start(...args)
        }
        return source
      }
    }
  })
  await page.route(`${base}/swf-compat-harness`, route =>
    route.fulfill({
      contentType: 'text/html',
      headers: { 'content-security-policy': "frame-src 'none'" },
      body: '<div style="width:1000px;height:600px" id="mount"></div>',
    }),
  )
  await page.goto(`${base}/swf-compat-harness`)
  const reports = []
  for (const number of [1, 2]) {
    const result = await page.evaluate(async number => {
      const { createSwfPlayer } = await import('/src/services/swf/adapter.ts')
      window.compatPlayer?.dispose()
      const source = `https://seer2-pet-resource.yuuinih.com/public/fight/${number}.swf`
      const movieResponse = await fetch(source, { cache: 'no-store', credentials: 'omit', redirect: 'error' })
      if (!movieResponse.ok) throw Error(`Original movie HTTP ${movieResponse.status}`)
      const movie = await movieResponse.arrayBuffer()
      const container = await fetch('/node_modules/seer2-pet-animator/dist/assets/0a23df2694577cca.swf', {
        cache: 'no-store',
      }).then(response => response.arrayBuffer())
      window.compatEvents = []
      const player = createSwfPlayer(document.getElementById('mount'), event => window.compatEvents.push(event))
      window.compatPlayer = player
      const states = await player.load({ movie, container })
      player.configure({ reverse: number === 2, width: 1000, height: 600 })
      return { source, movieBytes: movie.byteLength, containerBytes: container.byteLength, states }
    }, number)
    await page.click('body', { position: { x: 5, y: 5 } })
    await page.evaluate(() => window.compatPlayer.setState('物理攻击'))
    await page.waitForFunction(
      () => window.compatEvents.some(event => event.type === 'hit' && event.state === '物理攻击'),
      undefined,
      { timeout: 12000 },
    )
    await page.waitForFunction(
      () => window.compatEvents.some(event => event.type === 'complete' && event.state === '物理攻击'),
      undefined,
      { timeout: 12000 },
    )
    await page.evaluate(() => window.compatPlayer.setState('被打'))
    await page.waitForFunction(
      () => window.compatEvents.some(event => event.type === 'complete' && event.state === '被打'),
      undefined,
      { timeout: 12000 },
    )
    result.events = await page.evaluate(() => window.compatEvents)
    result.audio = await Promise.all(
      page.frames().map(frame =>
        frame.evaluate(() => ({
          states: window.audioContexts?.map(context => context.state),
          starts: window.audioStarts,
        })),
      ),
    )
    reports.push(result)
  }
  await page.evaluate(() => window.compatPlayer.dispose())
  const output = process.env.SWF_VALIDATION_OUTPUT || '/tmp/arcadia-swf-browser-validation.json'
  await writeFile(
    output,
    JSON.stringify({ date: new Date().toISOString(), browser: browser.version(), reports }, null, 2),
  )
  console.log(`Original SWF compatibility passed for two sprites; report: ${output}`)
} finally {
  await browser.close()
}
