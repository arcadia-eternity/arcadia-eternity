import { writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

export async function readChromeProbe(url, domFile) {
  const executablePath = process.env.BATTLE_CHROME
  const browser = await chromium.launch(executablePath ? { executablePath } : { channel: 'chrome' })
  try {
    const page = await browser.newPage()
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' })
      const result = await page.waitForFunction(
        () => {
          const text = document.querySelector('#result')?.textContent
          return text && text !== 'Running' ? text : false
        },
        undefined,
        { timeout: 30_000 },
      )
      return await result.jsonValue()
    } finally {
      if (domFile && !page.isClosed()) await writeFile(domFile, await page.content())
    }
  } finally {
    await browser.close()
  }
}
