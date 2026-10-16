import { rolldown } from 'rolldown'
import { mkdir, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'

const dir = resolve('packages/battle/dist/host-check')
await mkdir(dir, { recursive: true })
const graphs = {}
for (const platform of ['node', 'browser']) {
  const modules = []
  const build = await rolldown({
    input: 'packages/battle/test/core/host-smoke.ts',
    platform,
    plugins: [
      {
        name: 'core-boundary',
        moduleParsed(info) {
          modules.push(info.id)
          if (
            /packages\/(engine|engine-plugins|server|database|rules|web-ui|interface)\//.test(info.id) ||
            /node_modules\//.test(info.id)
          )
            throw new Error(`Forbidden core runtime dependency: ${info.id}`)
        },
      },
    ],
  })
  await build.write({ file: `${dir}/${platform}.mjs`, format: 'esm' })
  await build.close()
  graphs[platform] = modules.map(id => id.replace(`${process.cwd()}/`, '')).sort()
}
const { verifyCore } = await import(pathToFileURL(`${dir}/node.mjs`).href)
const result = verifyCore()
assert.equal(result.turn, 7)
assert.equal(result.victor, 'A')
assert.equal(result.identical, true)
await writeFile(`${dir}/graphs.json`, JSON.stringify(graphs, null, 2))
await writeFile(
  `${dir}/index.html`,
  `<!doctype html><meta charset="utf-8"><title>Battle Core host verification</title><pre id="result">Running</pre><script type="module">
import { verifyCore } from './browser.mjs';
try { const result = verifyCore(); document.querySelector('#result').textContent = JSON.stringify(result); window.coreResult = result; }
catch (error) { document.querySelector('#result').textContent = String(error); window.coreError = String(error); }
</script>`,
)
console.log(
  JSON.stringify({
    node: result,
    moduleCounts: Object.fromEntries(Object.entries(graphs).map(([k, v]) => [k, v.length])),
    browserPage: `${dir}/index.html`,
  }),
)

if (process.argv.includes('--browser')) {
  const { createServer } = await import('node:http')
  const { readFile, mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const profile = await mkdtemp(`${tmpdir()}/ae4-core-chrome-`)
  const server = createServer(async (request, response) => {
    const file = request.url === '/' ? 'index.html' : request.url === '/browser.mjs' ? 'browser.mjs' : null
    if (!file) {
      response.writeHead(404)
      response.end()
      return
    }
    response.setHeader('Content-Type', file.endsWith('.mjs') ? 'text/javascript' : 'text/html')
    response.end(await readFile(`${dir}/${file}`))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const chrome =
      process.env.BATTLE_CORE_CHROME ??
      (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome')
    const { stdout } = await promisify(execFile)(
      chrome,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--no-first-run',
        `--user-data-dir=${profile}`,
        '--dump-dom',
        '--virtual-time-budget=5000',
        `http://127.0.0.1:${server.address().port}/`,
      ],
      { timeout: 30000, maxBuffer: 1024 * 1024 },
    )
    const expected = JSON.stringify(result)
    assert.ok(
      stdout.includes(`<pre id="result">${expected}</pre>`),
      'Real browser replay/restore did not match Node result',
    )
    console.log(JSON.stringify({ browser: result, matchesNode: true }))
  } finally {
    await new Promise(resolve => server.close(resolve))
    await rm(profile, { recursive: true, force: true, maxRetries: 3 })
  }
}
