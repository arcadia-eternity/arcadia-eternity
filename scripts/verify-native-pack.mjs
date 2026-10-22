import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { rolldown } from 'rolldown'
import { identifyEnvironmentArtifact } from './build-battle-environment.mjs'

const directory = await mkdtemp(join(tmpdir(), 'arcadia-native-pack-'))
const modules = [],
  forbiddenRequests = []
let server
try {
  const bundle = await rolldown({
    input: resolve('packages/pack-loader/test/native-host.ts'),
    platform: 'browser',
    external: id => id.startsWith('node:'),
    plugins: [
      {
        name: 'native-pack-boundary',
        resolveId(id) {
          if (id === '@arcadia-eternity/battle/v4') return resolve('packages/battle/v4.ts')
          if (id === '@arcadia-eternity/battle/v4/host') return resolve('packages/battle/v4-host.ts')
        },
        moduleParsed(info) {
          modules.push(info.id)
          if (
            /\/legacy\/(?:effectBuilder\/|schema\/effect(?:Dsl|Schema)\.|parser\/(?:parseEffect|effect)\.)|\/src\/v2\//.test(
              info.id,
            )
          )
            throw new Error(`Legacy runtime dependency: ${info.id}`)
          if (
            /packages\/(?:engine|engine-plugins|server|database|rules|web-ui|interface|p2p-transport)\//.test(
              info.id,
            ) ||
            /(?:^|\/)(?:rxjs|prando)(?:@|\/)/.test(info.id)
          )
            throw new Error(`Foreign runtime dependency: ${info.id}`)
        },
      },
    ],
  })
  let code
  try {
    const result = await bundle.generate({ format: 'esm', codeSplitting: false, minify: true })
    code = result.output[0].code
  } finally {
    await bundle.close()
  }
  const identity = identifyEnvironmentArtifact(code)
  const output = join(directory, 'browser.mjs')
  await writeFile(output, code)
  const input = JSON.parse(
    await readFile('packages/battle/src/v2/__tests__/fixtures/baseline/official-switch.input.json', 'utf8'),
  )
  const html = `<!doctype html><meta charset="utf-8"><pre id="result">Running</pre><script type="module">
import { verifyNativePackHost } from './browser.mjs';
try {
const run = options => verifyNativePackHost(location.origin + '/pack/', ${JSON.stringify(identity)}, ${JSON.stringify(input)}, options);
document.querySelector('#result').textContent = JSON.stringify({ untimed: await run({}), timed: await run({timed:true}) });
}
catch (error) { document.querySelector('#result').textContent = String(error); }
</script>`
  server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname
      if (pathname === '/') {
        response.setHeader('Content-Type', 'text/html')
        response.end(html)
        return
      }
      if (pathname === '/browser.mjs') {
        response.setHeader('Content-Type', 'text/javascript')
        response.end(code)
        return
      }
      if (!pathname.startsWith('/pack/') || pathname.includes('..')) {
        response.writeHead(404)
        response.end()
        return
      }
      if (/\/effect_[^/]+\.(?:yaml|json)$/.test(pathname)) {
        forbiddenRequests.push(pathname)
        response.writeHead(400)
        response.end('Effect DSL is not served')
        return
      }
      response.end(await readFile(resolve('packs/base', pathname.slice('/pack/'.length))))
    } catch {
      response.writeHead(404)
      response.end()
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  const { verifyNativePackHost } = await import(pathToFileURL(output).href)
  const expected = {
    untimed: await verifyNativePackHost(`${url}/pack/`, identity, input),
    timed: await verifyNativePackHost(`${url}/pack/`, identity, input, { timed: true }),
  }
  if (process.argv.includes('--browser')) {
    const chrome =
      process.env.BATTLE_V1_CHROME ??
      (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome')
    const { stdout } = await promisify(execFile)(
      chrome,
      [
        '--headless=new',
        '--disable-gpu',
        ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
        '--no-first-run',
        `--user-data-dir=${join(directory, 'profile')}`,
        '--dump-dom',
        '--virtual-time-budget=15000',
        url,
      ],
      { timeout: 30000, maxBuffer: 1024 * 1024 },
    )
    assert.ok(
      stdout.includes(`<pre id="result">${JSON.stringify(expected)}</pre>`),
      `Native browser differs from Node: ${stdout.slice(-4000)}`,
    )
  }
  assert.deepEqual(forbiddenRequests, [])
  console.log(
    JSON.stringify({
      node: true,
      browser: process.argv.includes('--browser'),
      modules: modules.length,
      effects: expected.untimed.effects,
      turns: expected.untimed.turns,
      freshDirectoryRestore: true,
      battleSystemInterface: expected.untimed.battleSystemInterface,
      enabledTimerRestore: expected.timed.enabledTimers,
      activeAnimationRestore: expected.timed.activeAnimationRestore,
      reconnectRestore: expected.untimed.reconnectRestore && expected.timed.reconnectRestore,
      initialSnapshotRestore: expected.untimed.initialSnapshotRestore && expected.timed.initialSnapshotRestore,
      aiRestore: expected.untimed.aiRestore && expected.timed.aiRestore,
      legacyDslRequests: forbiddenRequests.length,
    }),
  )
} finally {
  if (server) await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true, maxRetries: 3 })
}
