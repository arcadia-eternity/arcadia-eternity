import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createServer, type Server } from 'node:https'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import {
  OFFICIAL_WORKSHOP_ROOT,
  WorkshopClient,
  canonicalJson,
  generateSigningKey,
  importSigningKey,
  sha256Hex,
  signEnvelope,
} from '@arcadia-eternity/pack-loader/workshop'

const require = createRequire(import.meta.url)
const DEMO = { title: '工坊投稿测试包', npm: '@yuuinih/arcadia-workshop-demo', version: '0.1.2' }
const PORTS = [8443, 8444]
const encode = (value: unknown) => new TextEncoder().encode(canonicalJson(value))
const memoryStore = () => {
  const states = new Map()
  return {
    read: async (id: string) => states.get(id),
    update: async (id: string, f: (s: unknown) => unknown) => {
      const next = await f(states.get(id))
      if (next) states.set(id, next)
      return next
    },
  }
}

test(
  'actual Electron window trusts a third-party registry, falls back to its mirror and applies its revocations',
  { timeout: 900000, skip: process.env.ARCADIA_LIVE_WORKSHOP_GUI !== '1' },
  async t => {
    const { _electron, expect: playwrightExpect } = require('playwright/test')
    const expect = playwrightExpect.configure({ timeout: 60000 })
    const origin = process.env.ARCADIA_DESKTOP_GUI_URL ?? 'http://127.0.0.1:5183'
    assert.ok((await fetch(origin, { signal: AbortSignal.timeout(5000) })).ok, 'Start the renderer first')
    const root = await mkdtemp(join(tmpdir(), 'arcadia-workshop-registry-gui-'))
    const servers: (Server | undefined)[] = []
    t.after(async () => {
      for (const server of servers) server?.closeAllConnections()
      await Promise.all(servers.map(server => server && new Promise(resolve => server.close(resolve))))
      await rm(root, { recursive: true, force: true })
    })

    // Republish the live official listing of the demo package under a local registry identity.
    const official = await new WorkshopClient({ trustedRoot: OFFICIAL_WORKSHOP_ROOT, store: memoryStore() }).refresh()
    assert.equal(official.freshness, 'fresh')
    const listed = official.index.projects.find(project => project.npm === DEMO.npm)
    assert.ok(listed?.releases.some(release => release.version === DEMO.version))

    const rootKey = await importSigningKey((await generateSigningKey()).pkcs8)
    const snapshotKey = await importSigningKey((await generateSigningKey()).pkcs8)
    const bases = PORTS.map(port => `https://localhost:${port}/`)
    const now = Date.now()
    const trustedRoot = await signEnvelope(
      {
        type: 'root',
        spec: 1,
        registry: 'local-community',
        version: 1,
        expires: new Date(now + 30 * 86_400_000).toISOString(),
        keys: { [rootKey.keyid]: rootKey.publicKey, [snapshotKey.keyid]: snapshotKey.publicKey },
        roles: {
          root: { keyids: [rootKey.keyid], threshold: 1 },
          snapshot: { keyids: [snapshotKey.keyid], threshold: 1 },
        },
        mirrors: bases,
      },
      [rootKey],
    )
    const files = new Map<string, Uint8Array>([['/root/1.json', encode(trustedRoot)]])
    async function publish(version: number, revocations: unknown[]) {
      const bytes = encode({
        type: 'index',
        spec: 1,
        registry: 'local-community',
        generatedAt: new Date().toISOString(),
        projects: [{ ...listed, id: 'local.workshop-demo', official: false }],
        revocations,
      })
      const sha256 = sha256Hex(bytes)
      files.set(`/objects/${sha256}.json`, bytes)
      files.set(
        '/snapshot.json',
        encode(
          await signEnvelope(
            {
              type: 'snapshot',
              spec: 1,
              registry: 'local-community',
              version,
              rootVersion: 1,
              expires: new Date(Date.now() + 7 * 86_400_000).toISOString(),
              index: { path: `objects/${sha256}.json`, sha256, length: bytes.length },
            },
            [snapshotKey],
          ),
        ),
      )
    }
    await publish(1, [])

    const config = join(root, 'openssl.conf'),
      key = join(root, 'key.pem'),
      cert = join(root, 'cert.pem')
    await writeFile(
      config,
      '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,digitalSignature,keyEncipherment\n',
    )
    await promisify(execFile)(
      'openssl',
      ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', key, '-out', cert, '-config', config],
      { timeout: 10000 },
    )
    const tls = { key: await readFile(key), cert: await readFile(cert) }
    const requests: string[] = []
    const start = (index: number) =>
      new Promise<void>((resolve, reject) => {
        const server = createServer(tls, (request, response) => {
          requests.push(PORTS[index] + (request.url ?? ''))
          const body = files.get(new URL(request.url ?? '/', 'https://localhost').pathname)
          response.writeHead(body ? 200 : 404, { 'content-type': 'application/json', 'cache-control': 'no-store' })
          response.end(body)
        })
        server.once('error', reject)
        server.listen(PORTS[index], '127.0.0.1', () => resolve())
        servers[index] = server
      })
    const stop = async (index: number) => {
      const server = servers[index]
      servers[index] = undefined
      server?.closeAllConnections()
      if (server) await new Promise(resolve => server.close(resolve))
    }
    await Promise.all(PORTS.map((_, index) => start(index)))

    const entry = join(root, 'entry.mjs')
    const main = pathToFileURL(fileURLToPath(new URL('../main.ts', import.meta.url))).href
    await writeFile(
      entry,
      `import {app} from 'electron';app.setPath('userData',${JSON.stringify(join(root, 'data'))});await import(${JSON.stringify(main)});`,
    )
    const env = { ...process.env, ARCADIA_ELECTRON_DEV_SERVER_URL: origin, NODE_EXTRA_CA_CERTS: cert }
    delete env.ELECTRON_RUN_AS_NODE
    const launch = async () => {
      const application = await _electron.launch({
        executablePath: require('electron'),
        args: [entry],
        env,
        timeout: 30000,
      })
      await application.evaluate(({ dialog }) => {
        const original = dialog.showMessageBox.bind(dialog)
        dialog.showMessageBox = ((window: unknown, options: { buttons?: string[] }) => {
          const accept = (options?.buttons ?? []).findIndex(label => label === '安装' || label === '允许此环境使用')
          return accept < 0
            ? original(window as never, options as never)
            : Promise.resolve({ response: accept, checkboxChecked: false })
        }) as typeof dialog.showMessageBox
      })
      return { application, page: await application.firstWindow({ timeout: 20000 }) }
    }
    const workshop = (page, input) => page.evaluate(request => window.arcadiaDesktop.workshop(request), input)
    const snapshot = page =>
      page.evaluate(async () => (await window.arcadiaDesktop.localEnvironment({ action: 'snapshot' })).result)
    const chooseRegistry = async page => {
      await page.locator('.registry-select').click()
      await page.getByRole('option', { name: 'local-community', exact: true }).click()
    }
    const fingerprint = sha256Hex(encode(trustedRoot))

    let { application, page } = await launch()
    try {
      await page.goto(origin + '/workshop')
      await page.getByRole('button', { name: '工坊源', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '工坊源' })
      await dialog.getByRole('textbox', { name: '工坊源地址' }).fill(bases[0])
      await dialog.getByRole('button', { name: '读取根密钥' }).click()
      const preview = dialog.getByRole('region', { name: '根密钥' })
      await expect(preview.getByText(fingerprint)).toBeVisible()
      await expect(preview.getByText('local-community', { exact: true })).toBeVisible()
      await preview.getByRole('button', { name: '信任此工坊源' }).click()
      await expect(dialog.getByRole('list', { name: '已添加的工坊源' }).getByText('local-community')).toBeVisible()
      await application.close()

      // The trusted root survives a restart; the primary mirror is down, so the second one serves the index.
      ;({ application, page } = await launch())
      await stop(0)
      requests.length = 0
      const fallback = await workshop(page, { action: 'refresh', registry: 'local-community' })
      assert.equal(fallback.result?.freshness, 'fresh', JSON.stringify(fallback))
      assert.ok(
        requests.some(url => url.startsWith('8444/snapshot.json')),
        requests.join(),
      )

      await page.goto(origin + '/workshop')
      await chooseRegistry(page)
      await page
        .getByRole('list', { name: '工坊项目' })
        .getByRole('button', { name: new RegExp(DEMO.title) })
        .click()
      const detail = page.getByRole('article', { name: DEMO.title })
      await expect(detail.getByText('官方', { exact: true })).toHaveCount(0)
      await detail.getByRole('button', { name: '安装', exact: true }).click()
      await expect(detail.getByText(`已安装 ${DEMO.title} ${DEMO.version}`)).toBeVisible({ timeout: 240000 })
      await page.keyboard.press('Escape')

      // Every mirror offline: the verified cache still lists projects but cannot authorize an install.
      await stop(1)
      await page.getByRole('button', { name: '刷新', exact: true }).click()
      await expect(page.getByRole('alert').filter({ hasText: '已显示离线缓存' })).toBeVisible()
      await page
        .getByRole('list', { name: '工坊项目' })
        .getByRole('button', { name: new RegExp(DEMO.title) })
        .click()
      await expect(detail.getByRole('button', { name: '安装', exact: true })).toBeDisabled()
      const offline = await workshop(page, {
        action: 'install',
        registry: 'local-community',
        npm: DEMO.npm,
        version: DEMO.version,
      })
      assert.match(JSON.stringify(offline), /WORKSHOP_INDEX_STALE/)
      await page.keyboard.press('Escape')

      // Copy the default environment and add the installed package to it.
      await page.goto(origin + '/environments?target=local')
      await page.getByRole('button', { name: '复制环境', exact: true }).click()
      await page.getByRole('button', { name: '保存并应用', exact: true }).click()
      await expect
        .poll(async () => (await snapshot(page)).operations.find(job => job.kind === 'environment.apply')?.status)
        .toBe('succeeded')
      const library = await page.evaluate(() => window.arcadiaDesktop.listContentPackages())
      const installed = library.packages.find(item => item.name === DEMO.npm)
      assert.ok(installed)
      const copy = (await snapshot(page)).environments.find(item => !item.builtin)
      const added = await page.evaluate(input => window.arcadiaDesktop.localEnvironment(input), {
        action: 'add-package',
        environmentId: copy.document.id,
        expectedRevision: copy.revision,
        name: DEMO.npm,
        version: DEMO.version,
      })
      const waitFor = async (operationId: string) => {
        await expect
          .poll(async () => (await snapshot(page)).operations.find(job => job.id === operationId)?.status, {
            timeout: 240000,
          })
          .not.toMatch(/^(queued|running)$/)
        return (await snapshot(page)).operations.find(job => job.id === operationId)
      }
      assert.equal((await waitFor(added.result.operationId)).status, 'succeeded')

      // The registry revokes the installed release.
      await publish(2, [
        { npm: DEMO.npm, version: DEMO.version, reason: '本地撤销验收', revokedAt: new Date().toISOString() },
      ])
      await start(0)
      await page.goto(origin + '/workshop')
      await chooseRegistry(page)
      await page.getByRole('button', { name: '刷新', exact: true }).click()
      await expect(
        page.getByRole('alert').filter({ hasText: `${DEMO.npm} ${DEMO.version} 已撤销 · 本地撤销验收` }),
      ).toBeVisible()

      // Committing the environment again is refused and leaves the previous revision in place.
      const current = (await snapshot(page)).environments.find(item => item.document.id === copy.document.id)
      const reapply = await page.evaluate(input => window.arcadiaDesktop.localEnvironment(input), {
        action: 'apply',
        document: current.document,
        expectedRevision: current.revision,
      })
      const refused = await waitFor(reapply.result.operationId)
      assert.equal(refused.status, 'failed')
      assert.equal(refused.error?.code, 'WORKSHOP_RELEASE_REVOKED')
      const after = (await snapshot(page)).environments.find(item => item.document.id === copy.document.id)
      assert.equal(after.revision, current.revision)

      // What an already-prepared environment does after revocation is reported, not asserted.
      const select = await page.evaluate(
        id => window.arcadiaDesktop.localEnvironment({ action: 'select', environmentId: id }),
        copy.document.id,
      )
      const selected = select.result?.operationId ? await waitFor(select.result.operationId) : select
      t.diagnostic('select after revocation: ' + JSON.stringify({ status: selected.status, error: selected.error }))

      await workshop(page, { action: 'remove-registry', registry: 'local-community' })
      const registries = await workshop(page, { action: 'registries' })
      assert.deepEqual(
        registries.result.registries.map(item => item.id),
        ['official'],
      )
    } catch (error) {
      await page
        ?.screenshot({ path: join(tmpdir(), 'arcadia-workshop-registry-failure.png'), fullPage: true })
        .catch(() => {})
      throw error
    } finally {
      await application?.close().catch(() => {})
    }
  },
)
