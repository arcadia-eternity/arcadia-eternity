import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { rolldown } from 'rolldown'

const directory = await mkdtemp(join(tmpdir(), 'arcadia-waiting-checkpoints-'))
let server, browserProbes
try {
  for (const platform of ['node', 'browser']) {
    const bundle = await rolldown({
      input: resolve('packages/battle/test/v4/waiting-snapshot-host.ts'),
      platform,
      plugins: [
        {
          name: 'waiting-checkpoint-boundary',
          resolveId(id) {
            if (id === '@arcadia-eternity/battle/v4') return resolve('packages/battle/v4.ts')
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
  const probes = await node.createWaitingCheckpointProbes()
  const expected = await node.resumeWaitingCheckpointProbes(JSON.parse(JSON.stringify(probes)))
  // Execute the minified bundle in Node too: constructor-name changes cannot break restore.
  const minified = await import(pathToFileURL(join(directory, 'browser.mjs')).href)
  assert.deepEqual(await minified.resumeWaitingCheckpointProbes(JSON.parse(JSON.stringify(probes))), expected)
  if (process.argv.includes('--browser')) {
    const html = `<!doctype html><meta charset="utf-8"><pre id="result">Running</pre><script type="module">
import { createWaitingCheckpointProbes, resumeWaitingCheckpointProbes } from './browser.mjs';
try {
  const fromNode = await (await fetch('./checkpoints.json')).json();
  const resumedNode = await resumeWaitingCheckpointProbes(fromNode);
  const fresh = await createWaitingCheckpointProbes();
  const resumedBrowser = await resumeWaitingCheckpointProbes(JSON.parse(JSON.stringify(fresh)));
  const sent = await fetch('./browser-checkpoints', {method:'POST', body:JSON.stringify(fresh)});
  if (!sent.ok) throw new Error('Could not return browser checkpoints');
  document.querySelector('#result').textContent = JSON.stringify({resumedNode,resumedBrowser});
} catch (error) { document.querySelector('#result').textContent = String(error.stack ?? error); }
</script>`
    server = createServer(async (request, response) => {
      if (request.url === '/browser-checkpoints' && request.method === 'POST') {
        let body = ''
        for await (const part of request) body += part
        browserProbes = JSON.parse(body)
        response.end('ok')
      } else if (request.url === '/checkpoints.json') {
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify(probes))
      } else if (request.url === '/browser.mjs') {
        response.setHeader('Content-Type', 'text/javascript')
        response.end(await readFile(join(directory, 'browser.mjs')))
      } else if (request.url === '/') {
        response.setHeader('Content-Type', 'text/html')
        response.end(html)
      } else {
        response.writeHead(404)
        response.end()
      }
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
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
    await writeFile(join(directory, 'browser-dom.html'), stdout)
    assert.ok(
      stdout.includes(`<pre id="result">${JSON.stringify({ resumedNode: expected, resumedBrowser: expected })}</pre>`),
      `Browser checkpoint mismatch: ${stdout.slice(-6000)}`,
    )
    assert.ok(browserProbes, 'Browser did not export checkpoints')
    assert.deepEqual(await node.resumeWaitingCheckpointProbes(browserProbes), expected)
  }
  console.log(
    JSON.stringify({
      node: true,
      browser: process.argv.includes('--browser'),
      minified: true,
      bidirectionalJsonRestore: Boolean(browserProbes),
      cases: expected.map(({ kind, turn, winner }) => ({ kind, turn, winner })),
      stateRngEventOrder: true,
      duplicatePrompts: false,
    }),
  )
} finally {
  if (server) await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true, maxRetries: 3 })
}
