import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rolldown } from 'rolldown'
import { readChromeProbe } from './read-chrome-probe.mjs'

const directory = await mkdtemp(join(tmpdir(), 'arcadia-waiting-checkpoints-'))
let server, browserProbes
try {
  for (const platform of ['node', 'browser']) {
    const bundle = await rolldown({
      input: resolve('packages/battle/test/engine/waiting-snapshot-host.ts'),
      platform,
      plugins: [
        {
          name: 'waiting-checkpoint-boundary',
          resolveId(id) {
            if (id === '@arcadia-eternity/battle/engine') return resolve('packages/battle/engine.ts')
            if (id === '@arcadia-eternity/battle/host') return resolve('packages/battle/host.ts')
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
try {
  const { createWaitingCheckpointProbes, resumeWaitingCheckpointProbes } = await import('./browser.mjs');
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
    const browserResult = await readChromeProbe(`http://127.0.0.1:${server.address().port}/`)
    assert.equal(
      browserResult,
      JSON.stringify({ resumedNode: expected, resumedBrowser: expected }),
      'Browser checkpoint mismatch',
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
