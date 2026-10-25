import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { rolldown } from 'rolldown'

const directory = await mkdtemp(join(tmpdir(), 'arcadia-behavior-uses-'))
const browserEnabled = process.argv.includes('--browser')
const jsonRoundTrip = value => JSON.parse(JSON.stringify(value))
let server, browserResult, serverError
try {
  for (const platform of ['node', 'browser']) {
    const bundle = await rolldown({
      input: resolve('packages/battle/test/v4/behavior-use-host.ts'),
      platform,
      plugins: [
        {
          name: 'behavior-use-boundary',
          resolveId(id) {
            if (id === '@arcadia-eternity/battle/v4') return resolve('packages/battle/v4.ts')
            if (id === '@arcadia-eternity/battle/v4/authoring') return resolve('packages/battle/v4-authoring.ts')
            if (id === '@arcadia-eternity/battle/v4/host') return resolve('packages/battle/v4-host.ts')
          },
          moduleParsed(info) {
            assert.doesNotMatch(
              info.id,
              /\/src\/v2\/|\/legacy\/(?:effectBuilder\/|schema\/effect(?:Dsl|Schema)\.|parser\/(?:parseEffect|effect)\.)|packages\/(?:engine|engine-plugins|server|database|rules|web-ui|p2p-transport)\//,
            )
            assert.doesNotMatch(info.id, /(?:^|\/)(?:rxjs|prando)(?:@|\/)/)
          },
        },
      ],
    })
    try {
      await bundle.write({
        file: join(directory, `${platform}.mjs`),
        format: 'esm',
        codeSplitting: false,
        minify: platform === 'browser',
      })
    } finally {
      await bundle.close()
    }
  }
  const node = await import(pathToFileURL(join(directory, 'node.mjs')).href)
  const probes = await node.createBehaviorUseProbes()
  const expected = await node.resumeBehaviorUseProbes(jsonRoundTrip(probes))
  const minified = await import(pathToFileURL(join(directory, 'browser.mjs')).href)
  assert.deepEqual(await minified.resumeBehaviorUseProbes(jsonRoundTrip(probes)), expected)

  if (browserEnabled) {
    const browserCode = await readFile(join(directory, 'browser.mjs'))
    const html = `<!doctype html><meta charset="utf-8"><pre id="result">Running</pre><script type="module">
import { createBehaviorUseProbes, resumeBehaviorUseProbes } from './browser.mjs';
try {
  const nodeProbes = await (await fetch('./probes.json')).json();
  const resumedNode = await resumeBehaviorUseProbes(nodeProbes);
  const probes = await createBehaviorUseProbes();
  const resumedBrowser = await resumeBehaviorUseProbes(JSON.parse(JSON.stringify(probes)));
  const sent = await fetch('./browser-result', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({probes, resumedNode, resumedBrowser}),
  });
  if (!sent.ok) throw new Error('Could not return browser probes: ' + sent.status);
  document.querySelector('#result').textContent = 'ok';
} catch (error) { document.querySelector('#result').textContent = String(error.stack ?? error); }
</script>`
    server = createServer(async (request, response) => {
      try {
        if (request.url === '/browser-result' && request.method === 'POST') {
          const chunks = []
          let bytes = 0
          for await (const chunk of request) {
            bytes += chunk.length
            if (bytes > 16 * 1024 * 1024) throw new Error('Browser probes exceed 16 MiB')
            chunks.push(chunk)
          }
          browserResult = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          response.end('ok')
        } else if (request.url === '/probes.json' && request.method === 'GET') {
          response.setHeader('Content-Type', 'application/json')
          response.end(JSON.stringify(probes))
        } else if (request.url === '/browser.mjs' && request.method === 'GET') {
          response.setHeader('Content-Type', 'text/javascript')
          response.end(browserCode)
        } else if (request.url === '/' && request.method === 'GET') {
          response.setHeader('Content-Type', 'text/html')
          response.end(html)
        } else {
          response.writeHead(404)
          response.end()
        }
      } catch (error) {
        serverError = error
        response.writeHead(400)
        response.end('Invalid browser probes')
      }
    })
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
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
        `http://127.0.0.1:${server.address().port}/`,
      ],
      { timeout: 30000, maxBuffer: 4 * 1024 * 1024 },
    )
    if (serverError) throw serverError
    assert.ok(stdout.includes('<pre id="result">ok</pre>'), `Browser behavior failure: ${stdout.slice(-6000)}`)
    assert.ok(browserResult, 'Browser did not return probes')
    assert.deepEqual(browserResult.resumedNode, expected, 'Chrome must restore Node probes identically')
    assert.deepEqual(browserResult.resumedBrowser, expected, 'Chrome must compile and restore fresh probes identically')
    assert.deepEqual(
      await node.resumeBehaviorUseProbes(jsonRoundTrip(browserResult.probes)),
      expected,
      'Node must restore Chrome probes identically',
    )
  }
  console.log(
    JSON.stringify({
      node: true,
      browser: browserEnabled,
      minified: true,
      bidirectionalJsonRestore: Boolean(browserResult),
      behaviorUses: expected,
    }),
  )
} finally {
  if (server) {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
  await rm(directory, { recursive: true, force: true, maxRetries: 3 })
}
