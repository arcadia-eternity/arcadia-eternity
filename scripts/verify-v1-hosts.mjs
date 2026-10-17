import { rolldown } from 'rolldown'
import { mkdir, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
const dir = resolve('packages/battle/dist/v1-host-check')
await mkdir(dir, { recursive: true })
const graphs = {}
for (const platform of ['node', 'browser']) {
  const modules = []
  const build = await rolldown({
    input: 'packages/battle/test/v4/host-smoke.ts',
    platform,
    plugins: [
      {
        name: 'v1-host-boundary',
        moduleParsed(info) {
          modules.push(info.id)
          if (/(?:^|\/)(?:rxjs|prando)(?:@|\/)/.test(info.id))
            throw new Error(`Removed dependency reintroduced: ${info.id}`)
          if (/packages\/(engine|engine-plugins|server|database|rules|web-ui|interface|p2p-transport)\//.test(info.id))
            throw new Error(`Forbidden V1 runtime dependency: ${info.id}`)
        },
      },
    ],
  })
  await build.write({
    file: `${dir}/${platform}.mjs`,
    format: 'esm',
    codeSplitting: false,
    minify: platform === 'browser',
  })
  await build.close()
  graphs[platform] = modules.map(id => id.replace(`${process.cwd()}/`, '')).sort()
}
const { verifyV1, createCheckpointProbe, resumeCheckpointProbe } = await import(pathToFileURL(`${dir}/node.mjs`).href)
const result = await verifyV1()
assert.equal(result.fullBattle.turn, 4)
assert.equal(result.fullBattle.winner, 'A')
assert.equal(result.originalDsl.attackRatio, 1.5)
const payload = await createCheckpointProbe()
await writeFile(`${dir}/checkpoint.json`, JSON.stringify(payload))
const { spawn } = await import('node:child_process')
const isolated = spawn(
  process.execPath,
  [
    '--input-type=module',
    '-e',
    `
import { resumeCheckpointProbe } from ${JSON.stringify(pathToFileURL(`${dir}/node.mjs`).href)};
let input=''; for await (const part of process.stdin) input += part;
console.log(JSON.stringify(await resumeCheckpointProbe(JSON.parse(input))));
`,
  ],
  { stdio: ['pipe', 'pipe', 'pipe'] },
)
let isolatedOut = '',
  isolatedError = ''
isolated.stdout.on('data', data => {
  isolatedOut += data
})
isolated.stderr.on('data', data => {
  isolatedError += data
})
isolated.stdin.end(JSON.stringify(payload))
const exitCode = await new Promise(resolve => isolated.on('close', resolve))
assert.equal(exitCode, 0, isolatedError)
const isolatedResult = JSON.parse(isolatedOut.trim())
assert.deepEqual(isolatedResult, result.checkpoint)
const minifiedHost = await import(pathToFileURL(`${dir}/browser.mjs`).href)
assert.deepEqual(await minifiedHost.resumeCheckpointProbe(payload), result.checkpoint)
const minifiedPayload = await minifiedHost.createCheckpointProbe()
assert.deepEqual(await resumeCheckpointProbe(minifiedPayload), result.checkpoint)
console.log(JSON.stringify({ minifiedBrowserBundle: true, bidirectionalNodeCheckpoint: true }))
await writeFile(`${dir}/isolated-checkpoint-result.json`, JSON.stringify(isolatedResult, null, 2))
console.log(JSON.stringify({ isolatedProcessRestore: true, checkpoint: isolatedResult }))

await writeFile(`${dir}/graphs.json`, JSON.stringify(graphs, null, 2))
await writeFile(`${dir}/node-result.json`, JSON.stringify(result, null, 2))
await writeFile(
  `${dir}/index.html`,
  `<!doctype html><meta charset="utf-8"><title>Original V1 host check</title><pre id="result">Running</pre><script type="module">
import { verifyV1, resumeCheckpointProbe } from './browser.mjs';
try { const result = await verifyV1();
const checkpoint = await (await fetch('./checkpoint.json')).json();
const crossHost = await resumeCheckpointProbe(checkpoint);
if (JSON.stringify(crossHost) !== JSON.stringify(result.checkpoint)) throw new Error('Node checkpoint differs in Browser');
document.querySelector('#result').textContent = JSON.stringify(result); }
catch (error) { document.querySelector('#result').textContent = String(error); }
</script>`,
)
console.log(
  JSON.stringify({
    node: { turns: result.fullBattle.turn, winner: result.fullBattle.winner, originalDsl: result.originalDsl },
    modules: Object.fromEntries(Object.entries(graphs).map(([k, v]) => [k, v.length])),
  }),
)
if (process.argv.includes('--browser')) {
  const { createServer } = await import('node:http')
  const { readFile, mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const profile = await mkdtemp(`${tmpdir()}/ae-v1-chrome-`)
  const server = createServer(async (request, response) => {
    const file =
      request.url === '/'
        ? 'index.html'
        : request.url === '/browser.mjs'
          ? 'browser.mjs'
          : request.url === '/checkpoint.json'
            ? 'checkpoint.json'
            : null
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
      process.env.BATTLE_V1_CHROME ??
      (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome')
    const { stdout } = await promisify(execFile)(
      chrome,
      [
        '--headless=new',
        '--disable-gpu',
        ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
        '--no-first-run',
        `--user-data-dir=${profile}`,
        '--dump-dom',
        '--virtual-time-budget=5000',
        `http://127.0.0.1:${server.address().port}/`,
      ],
      { timeout: 30000, maxBuffer: 1024 * 1024 },
    )
    await writeFile(`${dir}/browser-dom.html`, stdout)
    assert.ok(
      stdout.includes(`<pre id="result">${JSON.stringify(result)}</pre>`),
      'Real browser result differs from Node; inspect browser-dom.html',
    )
    console.log(
      JSON.stringify({
        browser: 'Chrome',
        minified: true,
        nodeCheckpointRestored: true,
        matchesNode: true,
        originalDsl: result.originalDsl,
      }),
    )
  } finally {
    await new Promise(resolve => server.close(resolve))
    await rm(profile, { recursive: true, force: true, maxRetries: 3 })
  }
}
