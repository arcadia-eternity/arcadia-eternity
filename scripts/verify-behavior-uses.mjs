import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rolldown } from 'rolldown'

const directory = await mkdtemp(join(tmpdir(), 'arcadia-behavior-uses-'))
const browserEnabled = process.argv.includes('--browser')
const suite = process.argv.includes('--templates')
  ? {
      entry: 'official-template-host.ts',
      create: 'createOfficialTemplateProbes',
      resume: 'resumeOfficialTemplateProbes',
      report: 'officialTemplates',
    }
  : {
      entry: 'behavior-use-host.ts',
      create: 'createBehaviorUseProbes',
      resume: 'resumeBehaviorUseProbes',
      report: 'behaviorUses',
    }
const jsonRoundTrip = value => JSON.parse(JSON.stringify(value))
let server, browser, browserExit, browserTimeout, browserResult, report
const ownsProcessGroup = process.platform !== 'win32'
function signalBrowser(signal) {
  if (!browser?.pid) return
  try {
    if (ownsProcessGroup) process.kill(-browser.pid, signal)
    else browser.kill(signal)
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}
async function waitForBrowserExit(milliseconds) {
  let timer
  try {
    return await Promise.race([
      browserExit.then(() => true),
      new Promise(resolve => {
        timer = setTimeout(() => resolve(false), milliseconds)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
try {
  for (const platform of ['node', 'browser']) {
    const bundle = await rolldown({
      input: resolve('packages/battle/test/v4', suite.entry),
      platform,
      plugins: [
        {
          name: 'behavior-use-boundary',
          resolveId(id) {
            if (id === '@arcadia-eternity/data-pack-base/native') return resolve('packs/base/native.ts')
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
  const probes = await node[suite.create]()
  const expected = await node[suite.resume](jsonRoundTrip(probes))
  const minified = await import(pathToFileURL(join(directory, 'browser.mjs')).href)
  assert.deepEqual(await minified[suite.resume](jsonRoundTrip(probes)), expected)

  if (browserEnabled) {
    const browserCode = await readFile(join(directory, 'browser.mjs'))
    let completeBrowser, failBrowser
    const html = `<!doctype html><meta charset="utf-8"><pre id="result">Running</pre><script type="module">
try {
  const { ${suite.create}: createProbes, ${suite.resume}: resumeProbes } = await import('./browser.mjs');
  const nodeProbes = await (await fetch('./probes.json')).json();
  const resumedNode = await resumeProbes(nodeProbes);
  const probes = await createProbes();
  const resumedBrowser = await resumeProbes(JSON.parse(JSON.stringify(probes)));
  const sent = await fetch('./browser-result', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({probes, resumedNode, resumedBrowser}),
  });
  if (!sent.ok) throw new Error('Could not return browser probes: ' + sent.status);
  document.querySelector('#result').textContent = 'ok';
} catch (error) {
  const message = String(error.stack ?? error);
  document.querySelector('#result').textContent = message;
  await fetch('./browser-error', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({message}),
  });
}
</script>`
    server = createServer(async (request, response) => {
      try {
        if (['/browser-result', '/browser-error'].includes(request.url) && request.method === 'POST') {
          const chunks = []
          let bytes = 0
          for await (const chunk of request) {
            bytes += chunk.length
            if (bytes > 16 * 1024 * 1024) throw new Error('Browser probes exceed 16 MiB')
            chunks.push(chunk)
          }
          const result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          response.end('ok')
          if (request.url === '/browser-error') failBrowser(new Error(`Browser behavior failure: ${result.message}`))
          else completeBrowser(result)
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
        failBrowser(error)
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
    let settled = false
    const completed = new Promise((resolve, reject) => {
      completeBrowser = result => {
        if (settled) return
        settled = true
        resolve(result)
      }
      failBrowser = error => {
        if (settled) return
        settled = true
        reject(error)
      }
    })
    let stderr = ''
    browser = spawn(
      chrome,
      [
        '--headless=new',
        '--disable-gpu',
        ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
        '--no-first-run',
        `--user-data-dir=${join(directory, 'profile')}`,
        `http://127.0.0.1:${server.address().port}/`,
      ],
      { detached: ownsProcessGroup, stdio: ['ignore', 'ignore', 'pipe'] },
    )
    browser.stderr.on('data', chunk => {
      stderr = (stderr + chunk.toString()).slice(-8192)
    })
    browserExit = new Promise(resolve => {
      browser.once('error', error => {
        failBrowser(error)
        resolve()
      })
      browser.once('exit', (code, signal) => {
        failBrowser(new Error(`Chrome exited before returning probes (${signal ?? code}): ${stderr}`))
        resolve()
      })
    })
    browserTimeout = setTimeout(() => failBrowser(new Error(`Browser probes timed out: ${stderr}`)), 45000)
    browserResult = await completed
    clearTimeout(browserTimeout)
    assert.ok(browserResult, 'Browser did not return probes')
    assert.deepEqual(browserResult.resumedNode, expected, 'Chrome must restore Node probes identically')
    assert.deepEqual(browserResult.resumedBrowser, expected, 'Chrome must compile and restore fresh probes identically')
    assert.deepEqual(
      await node[suite.resume](jsonRoundTrip(browserResult.probes)),
      expected,
      'Node must restore Chrome probes identically',
    )
  }
  report = {
    node: true,
    browser: browserEnabled,
    minified: true,
    bidirectionalJsonRestore: Boolean(browserResult),
    [suite.report]: expected,
  }
} finally {
  clearTimeout(browserTimeout)
  try {
    if (browserExit) {
      signalBrowser('SIGTERM')
      if (!(await waitForBrowserExit(1000))) {
        signalBrowser('SIGKILL')
        if (!(await waitForBrowserExit(2000))) throw new Error('Chrome did not exit after SIGKILL')
      }
      // Reap remaining children in our own group even if the browser parent already exited.
      if (ownsProcessGroup) signalBrowser('SIGKILL')
    }
  } finally {
    try {
      if (server) {
        server.closeAllConnections()
        await new Promise(resolve => server.close(resolve))
      }
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3 })
    }
  }
}
console.log(JSON.stringify(report))
