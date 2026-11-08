import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash, randomUUID, X509Certificate } from 'node:crypto'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

// No builds, dependency installation, public listeners or system trust changes.
// The proxy uses the same existing image and connects over a private Docker bridge.
// A supplied image is resolved to its immutable ID. Source provenance is only
// associated when an existing Docker evidence record names that exact image.
const DEFAULT_IMAGE = 'sha256:fcb6bcc5739ee951dd6668b6fdcf861943bfda6de99b55c67996e943b744f8b8'
const execute = promisify(execFile)
const script = fileURLToPath(import.meta.url)

async function runProxy() {
  const [certificate, key, target, control] = process.argv.slice(3)
  const upstream = new URL(target)
  const connections = []
  const boundaryProbes = []
  const managementRequests = []
  const peers = new Map()
  let forwardedRequests = 0
  const server = https.createServer(
    { cert: await readFile(certificate), key: await readFile(key) },
    (request, response) => {
      if (request.url === control) {
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        response.end(
          JSON.stringify({
            connections,
            boundaryProbes,
            managementRequests,
            peers: [...peers.values()],
            forwardedRequests,
          }),
        )
        return
      }
      const missingProto = request.url.startsWith(control + '/missing-proto/')
      const path = missingProto ? request.url.slice((control + '/missing-proto').length) : request.url
      const headers = { ...request.headers }
      // Do not pass user-supplied forwarding assertions to the backend.
      for (const name of Object.keys(headers))
        if (name === 'forwarded' || name.startsWith('x-forwarded-')) delete headers[name]
      if (!missingProto) headers['x-forwarded-proto'] = 'https'
      const observation = {
        path: path.split('?')[0],
        method: request.method,
        startedAt: Date.now(),
        forwardedProto: headers['x-forwarded-proto'] ?? null,
      }
      if (path.startsWith('/api/management/v1/')) managementRequests.push(observation)
      response.once('finish', () => {
        observation.downstreamFinished = true
      })
      response.once('close', () => {
        observation.downstreamClosedAt = Date.now()
        observation.downstreamFinishedAtClose = response.writableFinished
      })
      const outgoing = http.request(
        { hostname: upstream.hostname, port: upstream.port, method: request.method, path, headers },
        incoming => {
          observation.status = incoming.statusCode
          incoming.once('end', () => {
            observation.upstreamEnded = true
            observation.upstreamComplete = incoming.complete
          })
          incoming.once('aborted', () => {
            observation.upstreamAborted = true
          })
          incoming.once('error', error => {
            observation.upstreamError = error.code ?? 'unknown'
          })
          response.writeHead(incoming.statusCode, incoming.headers)
          incoming.pipe(response)
        },
      )
      outgoing.on('socket', socket => {
        const observe = () => {
          observation.localAddress = socket.localAddress
          observation.remoteAddress = socket.remoteAddress
          forwardedRequests++
          peers.set(`${socket.localAddress}:${socket.remoteAddress}`, {
            localAddress: socket.localAddress,
            remoteAddress: socket.remoteAddress,
          })
          // Keep boundary probes independently of the bounded asset-request log:
          // real no-store page refreshes can exceed its 300 most recent entries.
          if (missingProto || path === '/api/management/v1/session/bootstrap') boundaryProbes.push(observation)
          connections.push(observation)
          if (connections.length > 300) connections.shift()
        }
        if (socket.connecting) socket.once('connect', observe)
        else observe()
      })
      outgoing.on('error', error => {
        observation.outgoingError = error.code ?? 'unknown'
        if (!response.headersSent) response.writeHead(502)
        response.end()
      })
      request.on('aborted', () => {
        observation.downstreamRequestAborted = true
        outgoing.destroy()
      })
      request.pipe(outgoing)
    },
  )
  server.listen(8443, '0.0.0.0', () => process.stdout.write('HTTPS validation proxy ready\n'))
}

async function validate() {
  const root = resolve(dirname(script), '..')
  const image = process.argv[2] ?? DEFAULT_IMAGE
  const output = resolve(process.argv[3] ?? join(root, '.omo/evidence/docker-management-https.json'))
  const sourceEvidence = process.argv[4] ?? '.omo/evidence/docker-management.json'
  const runId = `arcadia-https-${randomUUID().slice(0, 12)}`
  const label = `arcadia.validation.run=${runId}`
  const artifactDirectory = join(root, 'packages/web-ui/test-results/docker-management-https', runId)
  const resources = { containers: [], volumes: [], networks: [] }
  const secrets = new Set()
  const evidence = {
    scenario: 'real HTTPS reverse proxy, non-loopback upstream and paired management UI',
    startedAt: new Date().toISOString(),
    image,
    accountMode: 'guest with an isolated host-issued owner code',
    checks: [],
    negativeCases: {},
    limitations: [
      'Temporary test certificate; no public CA, DNS, external platform or public deployment acceptance.',
      'SQLite transport integration only; existing PostgreSQL persistence evidence remains separate.',
      'No WSS/battle, load/fault matrix, account provider or backup restore acceptance in this scenario.',
    ],
    passed: false,
  }
  const started = Date.now()
  let temporary, browser, context, page
  const redact = value => {
    let text = String(value)
    for (const secret of secrets) if (secret) text = text.split(secret).join('[redacted]')
    return text
  }
  async function docker(args) {
    try {
      return (await execute('docker', args, { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 })).stdout.trim()
    } catch (error) {
      // Arguments may contain an ephemeral login code; never print them.
      throw new Error(`docker ${args[0]} failed (${error.code ?? 'unknown'}): ${redact(error.stderr ?? '')}`)
    }
  }
  async function until(check, description, timeout = 60_000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      try {
        const result = await check()
        if (result) return result
      } catch {
        // Readiness can precede the first accepting listener.
      }
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    throw new Error(`Timed out waiting for ${description}`)
  }
  const check = description => {
    evidence.checks.push(description)
    process.stdout.write(description + '\n')
  }
  async function request(origin, path, ca, options = {}) {
    return new Promise((resolve, reject) => {
      const outgoing = https.request(
        new URL(path, origin),
        { ...options, ca, rejectUnauthorized: true, timeout: 10_000 },
        incoming => {
          const tls = {
            authorized: incoming.socket.authorized,
            protocol: incoming.socket.getProtocol(),
            fingerprint256: incoming.socket.getPeerCertificate().fingerprint256,
          }
          let body = ''
          incoming.setEncoding('utf8')
          incoming.on('data', chunk => {
            body += chunk
            if (body.length > 2 * 1024 * 1024) outgoing.destroy(new Error('Probe response too large'))
          })
          incoming.on('error', reject)
          incoming.on('end', () => {
            let json
            try {
              json = JSON.parse(body)
            } catch {
              /* HTML is also used for readiness. */
            }
            resolve({ status: incoming.statusCode, headers: incoming.headers, body, json, tls })
          })
        },
      )
      outgoing.on('error', reject)
      outgoing.on('timeout', () => outgoing.destroy(new Error('HTTPS probe timed out')))
      outgoing.end(options.body)
    })
  }

  try {
    await mkdir(artifactDirectory, { recursive: true })
    const inspected = JSON.parse(await docker(['image', 'inspect', '--format', '{{json .}}', image]))
    if (/^sha256:[a-f0-9]{64}$/.test(image)) assert.equal(inspected.Id, image)
    evidence.imageIdentity = { id: inspected.Id, os: inspected.Os, architecture: inspected.Architecture }
    const previousBytes = await readFile(resolve(root, sourceEvidence)).catch(error => {
      if (error.code !== 'ENOENT') throw error
      return undefined
    })
    const previous = previousBytes ? JSON.parse(previousBytes) : undefined
    evidence.sourceProof =
      previous?.imageIdentity?.id === inspected.Id
        ? {
            reference: sourceEvidence,
            referenceSha256: createHash('sha256').update(previousBytes).digest('hex'),
            scope:
              'Exact immutable image matches the referenced Docker evidence; not relabelled as current checkout HEAD.',
          }
        : { scope: 'Caller-supplied image; source provenance not independently established here.' }
    temporary = await mkdtemp(join(tmpdir(), 'arcadia-https-validation-'))
    const certificate = join(temporary, 'certificate.pem')
    const key = join(temporary, 'key.pem')
    await execute('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-keyout',
      key,
      '-out',
      certificate,
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ])
    // This disposable key is only valid for the fixture. The read-only mounted
    // directory must be readable by the image's unprivileged UID 1001.
    await chmod(temporary, 0o755)
    await chmod(key, 0o644)
    await copyFile(script, join(temporary, 'harness.mjs'))
    const ca = await readFile(certificate)
    const x509 = new X509Certificate(ca)
    const spki = createHash('sha256')
      .update(x509.publicKey.export({ type: 'spki', format: 'der' }))
      .digest('base64')
    evidence.certificate = {
      fingerprint256: x509.fingerprint256,
      subjectAltName: x509.subjectAltName,
      trust: 'Node validates the exact local certificate and SAN; Chrome has only its SPKI exception in this run.',
    }
    const proxy = `${runId}-proxy`,
      app = `${runId}-app`,
      volume = `${runId}-state`
    const control = `/__validation_${randomUUID().replaceAll('-', '')}`
    resources.networks.push(runId)
    await docker(['network', 'create', '--label', label, runId])
    resources.volumes.push(volume)
    await docker(['volume', 'create', '--label', label, volume])
    resources.containers.push(proxy)
    await docker([
      'run',
      '-d',
      '--name',
      proxy,
      '--label',
      label,
      '--network',
      runId,
      '-p',
      '127.0.0.1::8443',
      '--mount',
      `type=bind,src=${temporary},dst=/fixture,readonly`,
      '--entrypoint',
      'node',
      image,
      '/fixture/harness.mjs',
      '--proxy',
      '/fixture/certificate.pem',
      '/fixture/key.pem',
      `http://${app}:8102`,
      control,
    ])
    const mapped = await docker(['port', proxy, '8443/tcp'])
    assert.match(mapped, /^127\.0\.0\.1:\d+$/)
    const origin = `https://${mapped}`
    const proxyInspection = JSON.parse(await docker(['inspect', '--format', '{{json .NetworkSettings}}', proxy]))
    const proxyAddress = proxyInspection.Networks[runId].IPAddress
    assert.ok(proxyAddress && !proxyAddress.startsWith('127.'))
    const serverId = `${runId}-server`
    resources.containers.push(app)
    await docker([
      'run',
      '-d',
      '--name',
      app,
      '--label',
      label,
      '--network',
      runId,
      '-v',
      `${volume}:/app/state`,
      '-e',
      'ACCOUNT_MODE=guest',
      '-e',
      'STORAGE_DRIVER=sqlite',
      '-e',
      `SERVER_ID=${serverId}`,
      '-e',
      `PUBLIC_ORIGIN=${origin}`,
      '-e',
      `CORS_ORIGIN=${origin}`,
      '-e',
      `MANAGEMENT_TRUSTED_PROXY_IPS=${proxyAddress}`,
      '-e',
      'MANAGEMENT_REQUIRE_TLS=true',
      '-e',
      'MANAGEMENT_COOKIE_SAME_SITE=strict',
      '-e',
      'ARCADIA_WEB_AUTO_CONNECT=false',
      image,
    ])
    const appInspection = JSON.parse(await docker(['inspect', '--format', '{{json .NetworkSettings}}', app]))
    assert.equal(appInspection.Ports['8102/tcp'], null, 'Backend must have no host-published port')
    const health = await until(async () => {
      const result = await request(origin, '/health', ca)
      return result.status === 200 ? result : undefined
    }, 'HTTPS proxy and CLI backend')
    assert.equal(health.tls.authorized, true)
    assert.equal(health.tls.fingerprint256, x509.fingerprint256)
    evidence.transport = { origin, proxyAddress, appAddress: appInspection.Networks[runId].IPAddress, ...health.tls }
    check('Exact certificate and SAN validated over real TLS; upstream is a separate private bridge address')

    const missing = await request(origin, `${control}/missing-proto/api/management/v1/servers`, ca)
    assert.equal(missing.status, 403)
    assert.equal(missing.json.error.code, 'MANAGEMENT_TLS_REQUIRED')
    evidence.negativeCases.missingProxyHttpsHeader = { status: missing.status, code: missing.json.error.code }
    const probe = `${runId}-untrusted`
    resources.containers.push(probe)
    const spoof = JSON.parse(
      await docker([
        'run',
        '--rm',
        '--name',
        probe,
        '--label',
        label,
        '--network',
        runId,
        '--entrypoint',
        'node',
        image,
        '--input-type=module',
        '-e',
        `
      import {networkInterfaces} from 'node:os';
      const response = await fetch(${JSON.stringify(`http://${app}:8102/api/management/v1/servers`)},
        {headers:{'X-Forwarded-Proto':'https'}});
      const body = await response.json();
      console.log(JSON.stringify({status:response.status,code:body.error?.code,
        addresses:Object.values(networkInterfaces()).flat().filter(item=>!item.internal && item.family==='IPv4').map(item=>item.address)}));
      `,
      ]),
    )
    assert.equal(spoof.status, 403)
    assert.equal(spoof.code, 'MANAGEMENT_TLS_REQUIRED')
    assert.ok(spoof.addresses.length && !spoof.addresses.includes(proxyAddress))
    evidence.negativeCases.untrustedForwardedHeader = spoof
    check('Trusted proxy without HTTPS assertion and untrusted peer spoofing HTTPS both rejected')

    // This is the only dependency import: run after the installation owner's
    // dependency window has closed. The application under test stays in Docker.
    const { chromium, expect: baseExpect } = createRequire(join(root, 'packages/web-ui/package.json'))(
      'playwright/test',
    )
    const expect = baseExpect.configure({ timeout: 15_000 })
    const executablePath = process.env.ARCADIA_HTTPS_BROWSER_EXECUTABLE
    browser = await chromium.launch({
      ...(executablePath ? { executablePath } : { channel: 'chrome' }),
      headless: true,
      args: [`--ignore-certificate-errors-spki-list=${spki}`],
    })
    evidence.browserRuntime = {
      version: browser.version(),
      executablePath: executablePath ?? null,
      channel: executablePath ? null : 'chrome',
    }
    context = await browser.newContext({ acceptDownloads: true })
    page = await context.newPage()
    page.setDefaultTimeout(15_000)
    page.setDefaultNavigationTimeout(30_000)
    const browserErrors = [],
      unexpectedResponses = [],
      requestFailures = [],
      expectedAuthenticationResponses = [],
      expectedNavigationCancellations = []
    // Preserve observations even when an earlier UI assertion fails.
    evidence.browser = {
      errors: browserErrors,
      unexpectedResponses,
      requestFailures,
      expectedAuthenticationResponses,
      expectedNavigationCancellations,
    }
    const requestPhases = new WeakMap()
    let authenticationPhase = 'anonymous'
    let navigationGeneration = 0
    let csrfProbe = false
    page.on('request', request => requestPhases.set(request, { authenticationPhase, navigationGeneration }))
    page.on('pageerror', error => browserErrors.push(redact(error.message)))
    page.on('requestfailed', failed => {
      const phase = requestPhases.get(failed)
      const url = new URL(failed.url())
      const failure = {
        path: url.pathname,
        method: failed.method(),
        error: failed.failure()?.errorText,
        requestGeneration: phase?.navigationGeneration,
        currentGeneration: navigationGeneration,
      }
      if (
        failure.error === 'net::ERR_ABORTED' &&
        ['GET', 'HEAD'].includes(failure.method) &&
        url.origin === origin &&
        !/^\/api\/management\/v1\/(backups|transfers)\//.test(url.pathname) &&
        phase?.navigationGeneration < navigationGeneration
      )
        expectedNavigationCancellations.push({ ...failure, reason: 'Explicit reload replaced the requesting document' })
      else requestFailures.push(failure)
    })
    page.on('response', response => {
      const path = new URL(response.url()).pathname
      if (response.status() < 400) return
      const phase = requestPhases.get(response.request())?.authenticationPhase
      // The initial capability refresh asks for operation/credential metadata;
      // its anonymous 401s deliberately select the login view. Authenticated
      // refreshes must succeed. Requests after logout must lose access again.
      if (
        response.status() === 401 &&
        ['GET', 'POST'].includes(response.request().method()) &&
        ((phase === 'anonymous' &&
          /^\/api\/management\/v1\/(session|session\/refresh|servers|operations|credentials)$/.test(path)) ||
          (phase === 'logout' && path.startsWith('/api/management/v1/')))
      ) {
        expectedAuthenticationResponses.push({ phase, path, status: response.status() })
        return
      }
      if (csrfProbe && response.status() === 403 && response.request().method() === 'PATCH') return
      unexpectedResponses.push({ path, status: response.status() })
    })
    const issued = JSON.parse(await docker(['exec', app, 'node', 'dist/cli.js', 'server', 'admin', 'login-code']))
    secrets.add(issued.code)
    assert.equal(issued.serverId, serverId)
    evidence.identity = { serverId, workspaceId: issued.workspaceId }
    await page.goto(origin + '/management?tab=environments')
    await expect(page.getByRole('heading', { name: '登录管理后台', exact: true })).toBeVisible()
    await page.getByText('首次设置或恢复管理员访问', { exact: true }).click()
    await page.getByLabel('一次性登录码', { exact: true }).fill(issued.code)
    await page.getByRole('button', { name: '使用登录码进入', exact: true }).click()
    await expect(page.getByRole('button', { name: '新建环境', exact: true })).toBeEnabled()
    authenticationPhase = 'authenticated'
    assert.equal(
      await page.evaluate(async () => (await (await fetch('/api/management/v1/session')).json()).serverId),
      serverId,
    )
    const cookies = await context.cookies(origin + '/api/management/v1/session')
    const cookie = cookies.find(item => item.name === 'arcadia_management')
    assert.ok(cookie, 'The browser must accept the management cookie')
    secrets.add(cookie.value)
    assert.equal(cookie.secure, true)
    assert.equal(cookie.httpOnly, true)
    assert.equal(cookie.sameSite, 'Strict')
    assert.equal(cookie.path, '/api/management/v1')
    evidence.cookie = {
      name: cookie.name,
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
    }
    const reused = await request(origin, '/api/management/v1/session/bootstrap', ca, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: issued.code }),
    })
    assert.equal(reused.status, 401)
    issued.code = ''
    await page.waitForLoadState('networkidle')
    navigationGeneration++
    await page.reload()
    await expect(page.getByRole('button', { name: '新建环境', exact: true })).toBeEnabled()
    check('Real paired UI consumed a one-use code; browser Secure/HttpOnly/Strict cookie survives refresh')

    await page.getByRole('button', { name: '概览', exact: true }).click()
    const name = 'HTTPS proxy acceptance'
    await page.getByLabel('服务器名称', { exact: true }).fill(name)
    const saved = page.waitForResponse(
      response =>
        response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname === `/api/management/v1/servers/${serverId}`,
    )
    await page.getByRole('button', { name: '保存名称', exact: true }).click()
    assert.equal((await saved).status(), 200)
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
    await page.waitForLoadState('networkidle')
    navigationGeneration++
    await page.reload()
    await page.getByRole('button', { name: '概览', exact: true }).click()
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
    const server = await page.evaluate(
      async () => (await (await fetch('/api/management/v1/servers')).json()).servers[0],
    )
    assert.equal(server.name, name)
    const session = await page.evaluate(async () => (await fetch('/api/management/v1/session')).json())
    secrets.add(session.csrfToken)
    csrfProbe = true
    const rejectedCsrf = await page.evaluate(
      async ({ id, revision }) => {
        const response = await fetch(`/api/management/v1/servers/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'If-Match': String(revision) },
          body: JSON.stringify({ name: 'must not be written' }),
        })
        return { status: response.status, code: (await response.json()).error?.code }
      },
      { id: serverId, revision: server.revision },
    )
    csrfProbe = false
    assert.deepEqual(rejectedCsrf, { status: 403, code: 'CSRF_REJECTED' })
    evidence.negativeCases.missingCsrf = rejectedCsrf
    const wrongOrigin = await request(origin, `/api/management/v1/servers/${serverId}`, ca, {
      method: 'PATCH',
      headers: {
        Origin: 'https://untrusted.invalid',
        Cookie: `arcadia_management=${cookie.value}`,
        'X-CSRF-Token': session.csrfToken,
        'Content-Type': 'application/json',
        'If-Match': String(server.revision),
      },
      body: JSON.stringify({ name: 'must not be written' }),
    })
    assert.equal(wrongOrigin.status, 403)
    assert.equal(wrongOrigin.json.error.code, 'ORIGIN_FORBIDDEN')
    evidence.negativeCases.wrongOrigin = { status: wrongOrigin.status, code: wrongOrigin.json.error.code }
    const unchanged = await page.evaluate(
      async () => (await (await fetch('/api/management/v1/servers')).json()).servers[0],
    )
    assert.equal(unchanged.name, name)
    assert.equal(unchanged.revision, server.revision)
    evidence.managementWrite = { name, revision: server.revision, rejectedWritesPreservedRevision: true }
    check('UI management write persists on refresh; missing CSRF and wrong Origin cannot mutate it')

    await page.getByRole('button', { name: '创建服务器备份', exact: true }).click()
    const backupTask = page.locator('.operation').filter({ has: page.getByText('服务器备份', { exact: true }) })
    await expect(backupTask.getByText('已完成', { exact: true })).toBeVisible({ timeout: 60_000 })
    await backupTask.screenshot({ path: join(artifactDirectory, 'backup-completed.png') })
    const pendingDownload = page.waitForEvent('download')
    await backupTask.getByRole('button', { name: '下载服务器备份', exact: true }).click()
    const download = await pendingDownload
    const archiveText = await readFile(await download.path(), 'utf8')
    const archive = JSON.parse(archiveText)
    assert.equal(archive.format, 'arcadia.server-backup/1')
    assert.equal(archive.serverId, serverId)
    assert.equal(archive.workspace.workspaceId, issued.workspaceId)
    assert.ok(archive.workspace.versions.length > 0)
    assert.deepEqual(archive.storage.records.credentials, [])
    assert.deepEqual(archive.storage.records.sessions, [])
    for (const secret of secrets) assert.equal(archiveText.includes(secret), false, 'Backup must omit active secrets')
    const recordedServer = archive.storage.records.servers.find(item => item.id === serverId)
    assert.equal(recordedServer.value.name, name)
    const binding = archive.storage.records.bindings.find(item => item.id === recordedServer.value.defaultBindingId)
    assert.ok(binding)
    assert.ok(archive.workspace.versions.some(item => item.version.versionId === binding.value.desiredVersionId))
    const archivePath = join(artifactDirectory, 'server-backup.json')
    await download.saveAs(archivePath)
    await docker(['cp', archivePath, `${app}:/tmp/https-management-backup.json`])
    const inspectedBackup = JSON.parse(
      await docker([
        'exec',
        app,
        'node',
        'dist/cli.js',
        'server',
        'backup',
        'inspect',
        '--file',
        '/tmp/https-management-backup.json',
      ]),
    )
    assert.equal(inspectedBackup.serverId, serverId)
    assert.equal(inspectedBackup.workspaceId, issued.workspaceId)
    evidence.backup = {
      ...inspectedBackup,
      sha256: createHash('sha256').update(archiveText).digest('hex'),
      activeCredentialsExcluded: true,
    }
    check(
      'UI online backup download over HTTPS contains stable identity/material references and excludes active secrets',
    )

    authenticationPhase = 'logout'
    await page.getByRole('button', { name: '退出管理', exact: true }).click()
    await expect(page.getByRole('heading', { name: '登录管理后台', exact: true })).toBeVisible()
    assert.equal(
      (await context.cookies(origin + '/api/management/v1/session')).some(item => item.name === 'arcadia_management'),
      false,
    )
    const afterLogout = await page.evaluate(async () => {
      const response = await fetch('/api/management/v1/servers')
      await response.arrayBuffer()
      return response.status
    })
    assert.equal(afterLogout, 401)
    const revoked = await request(origin, '/api/management/v1/servers', ca, {
      headers: { Cookie: `arcadia_management=${cookie.value}`, Origin: origin },
    })
    assert.equal(revoked.status, 401)
    evidence.logout = { browserStatus: afterLogout, replayedSessionStatus: revoked.status }
    await page.screenshot({ path: join(artifactDirectory, 'logged-out.png'), fullPage: true })
    const telemetry = (await request(origin, control, ca)).json
    await writeFile(join(artifactDirectory, 'proxy-observations.json'), JSON.stringify(telemetry, null, 2) + '\n')
    evidence.proxyObservations = {
      forwardedRequests: telemetry.forwardedRequests,
      peers: telemetry.peers,
      boundaryProbes: telemetry.boundaryProbes,
      recentRequestLog: join(artifactDirectory, 'proxy-observations.json'),
    }
    assert.ok(telemetry.connections.length > 0)
    assert.ok(telemetry.peers.length > 0)
    assert.ok(
      telemetry.peers.every(
        item => item.localAddress === proxyAddress && item.remoteAddress === evidence.transport.appAddress,
      ),
    )
    assert.ok(telemetry.boundaryProbes.some(item => item.forwardedProto === null && item.status === 403))
    assert.ok(
      telemetry.boundaryProbes.some(
        item =>
          item.path === '/api/management/v1/session/bootstrap' &&
          item.forwardedProto === 'https' &&
          item.status === 200,
      ),
    )
    evidence.browser = {
      errors: browserErrors,
      unexpectedResponses,
      requestFailures,
      expectedAuthenticationResponses,
      rawRequestFailureCount: requestFailures.length + expectedNavigationCancellations.length,
      expectedNavigationCancellations,
    }
    evidence.serviceWorkers = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return { supported: false, registrations: [] }
      return {
        supported: true,
        controlled: !!navigator.serviceWorker.controller,
        registrations: (await navigator.serviceWorker.getRegistrations()).map(item => ({
          scope: new URL(item.scope).pathname,
          activeScript: item.active ? new URL(item.active.scriptURL).pathname : null,
        })),
      }
    })
    assert.deepEqual(browserErrors, [])
    assert.deepEqual(unexpectedResponses, [])
    assert.deepEqual(requestFailures, [])
    check(
      'Logout removes the cookie and revokes replay; proxy telemetry confirms all upstream connections are non-loopback',
    )
    evidence.passed = true
  } catch (error) {
    evidence.error = redact(error.stack ?? error.message ?? error)
    if (page && !page.isClosed()) {
      // Avoid screenshots of a failed login input containing a one-use code.
      try {
        await page.getByLabel('一次性登录码', { exact: true }).fill('', { timeout: 500 })
      } catch {
        /* The logged-in view has no login input. */
      }
      try {
        await page.screenshot({ path: join(artifactDirectory, 'failure.png'), fullPage: true })
      } catch {
        /* Preserve primary error. */
      }
    }
  } finally {
    const cleanupErrors = []
    for (const close of [() => context?.close(), () => browser?.close()]) {
      try {
        await close()
      } catch (error) {
        cleanupErrors.push(redact(error.message))
      }
    }
    for (const name of [...resources.containers].reverse()) {
      try {
        const present = await docker(['ps', '-aq', '--filter', `name=^/${name}$`])
        if (present) await docker(['rm', '-f', name])
      } catch (error) {
        cleanupErrors.push(error.message)
      }
    }
    for (const name of resources.volumes) {
      try {
        await docker(['volume', 'rm', name])
      } catch (error) {
        cleanupErrors.push(error.message)
      }
    }
    for (const name of resources.networks) {
      try {
        await docker(['network', 'rm', name])
      } catch (error) {
        cleanupErrors.push(error.message)
      }
    }
    let temporaryCertificateRemoved = false
    if (temporary) {
      try {
        await rm(temporary, { recursive: true, force: true })
        temporaryCertificateRemoved = true
      } catch (error) {
        cleanupErrors.push(error.message)
      }
    }
    try {
      const count = text => (text ? text.split('\n').length : 0)
      evidence.cleanup = {
        containers: count(await docker(['ps', '-aq', '--filter', `label=${label}`])),
        volumes: count(await docker(['volume', 'ls', '-q', '--filter', `label=${label}`])),
        networks: count(await docker(['network', 'ls', '-q', '--filter', `label=${label}`])),
        temporaryCertificateRemoved,
        errors: cleanupErrors,
      }
      if (evidence.cleanup.containers || evidence.cleanup.volumes || evidence.cleanup.networks || cleanupErrors.length)
        evidence.passed = false
    } catch (error) {
      evidence.passed = false
      evidence.cleanup = { errors: [...cleanupErrors, error.message] }
    }
    evidence.durationMs = Date.now() - started
    evidence.finishedAt = new Date().toISOString()
    evidence.artifactDirectory = artifactDirectory
    await mkdir(dirname(output), { recursive: true })
    const serialized = JSON.stringify(evidence, null, 2) + '\n'
    await writeFile(join(artifactDirectory, 'acceptance.json'), serialized)
    await writeFile(output, serialized)
    process.stdout.write(
      JSON.stringify({
        passed: evidence.passed,
        checks: evidence.checks.length,
        evidence: output,
        durationMs: evidence.durationMs,
      }) + '\n',
    )
    if (!evidence.passed) {
      process.stderr.write((evidence.error ?? 'Cleanup did not complete') + '\n')
      process.exitCode = 1
    }
  }
}

if (process.argv[2] === '--proxy') await runProxy()
else await validate()
