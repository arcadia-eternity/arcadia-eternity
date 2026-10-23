import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { identifyEnvironmentArtifact } from './build-battle-environment.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const dir = resolve(root, 'packages/battle/dist')
const code = await readFile(`${dir}/environment-runtime.mjs`, 'utf8')
const build = JSON.parse(await readFile(`${dir}/environment-build.json`, 'utf8'))
assert.deepEqual(build, identifyEnvironmentArtifact(code))
assert.notDeepEqual(build, identifyEnvironmentArtifact(`${code}\n// altered artifact`))
const pack = await readFile(resolve(root, 'docs/v4/examples/ugc-recovery-pack.json'), 'utf8')
// Execute the artifact whose exact bytes were verified, not the development package entry.
const runtime = await import(pathToFileURL(`${dir}/environment-runtime.mjs`).href)
const environment = await runtime.lockContentEnvironment([pack], build)
const expected = { manifest: environment.manifest, transport: environment.transport }
assert.equal(expected.transport[0].transportDigest, createHash('sha256').update(pack).digest('hex'))
const resources = new Map([
  ['/runtime.mjs', ['text/javascript', code]],
  ['/build.json', ['application/json', JSON.stringify(build)]],
  ['/pack.json', ['application/json', pack]],
  [
    '/',
    [
      'text/html',
      `<pre id="result">pending</pre><script type="module">
try {
  const {lockContentEnvironment} = await import('./runtime.mjs');
  const build = await (await fetch('./build.json')).json();
  const pack = await (await fetch('./pack.json')).text();
  const environment = await lockContentEnvironment([pack], build);
  const roundtrip = await lockContentEnvironment([JSON.stringify(environment.packs[0].data)], build, environment.manifest.environmentDigest);
  if (roundtrip.manifest.environmentDigest !== environment.manifest.environmentDigest) throw new Error('Normalization mismatch');
  let rejected = false;
  try { await lockContentEnvironment([pack], {...build, registryBuildId: '0'.repeat(64)}, environment.manifest.environmentDigest); }
  catch { rejected = true; }
  if (!rejected) throw new Error('Mismatched build accepted');
  document.querySelector('#result').textContent = JSON.stringify({manifest: environment.manifest, transport: environment.transport});
} catch (error) { document.querySelector('#result').textContent = String(error); }
</script>`,
    ],
  ],
])
const server = createServer((request, response) => {
  const resource = resources.get(request.url)
  if (!resource) {
    response.writeHead(404)
    response.end()
    return
  }
  response.setHeader('Content-Type', resource[0])
  response.end(resource[1])
})
const profile = await mkdtemp(`${tmpdir()}/ae-environment-chrome-`)
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
  await writeFile(`${dir}/environment-browser-dom.html`, stdout)
  assert.ok(
    stdout.includes(`<pre id="result">${JSON.stringify(expected)}</pre>`),
    'Chrome environment differs from Node; inspect environment-browser-dom.html',
  )
  console.log(
    JSON.stringify({
      artifactVerified: true,
      nodeAndChromeExecuteSameArtifact: true,
      normalizedEnvironmentMatches: true,
      digest: expected.manifest.environmentDigest,
    }),
  )
} finally {
  await new Promise(resolve => server.close(resolve))
  await rm(profile, { recursive: true, force: true, maxRetries: 3 })
}
