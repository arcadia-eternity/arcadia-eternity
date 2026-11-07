import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createDesktopInstallerWorkspace } from './desktop-installer-artifacts.mjs'
import { bounded, shutdownDesktopProcess } from './desktop-acceptance-process.mjs'

const require = createRequire(new URL('../packages/web-ui/package.json', import.meta.url))
const hash = value => createHash('sha256').update(value).digest('hex')

/** Runs the application entry in its actual ASAR. Neither a replacement main
 * module nor ELECTRON_RUN_AS_NODE is used for GUI acceptance. */
export async function verifyInstalledDesktop(installation, { evidenceDirectory, label, baseline, sourceProof } = {}) {
  const { _electron, expect } = require('playwright/test')
  await mkdir(evidenceDirectory, { recursive: true })
  const env = { ...process.env }
  for (const key of ['ELECTRON_RUN_AS_NODE', ARCADIA_DEV_SERVER, 'NODE_OPTIONS', 'NODE_TEST_CONTEXT']) delete env[key]
  const errors = [],
    responses = [],
    consoleErrors = [],
    externalRequests = []
  let app, child, page, host, localPort, result
  const output = [],
    attached = new WeakSet()
  const observe = page => {
    if (attached.has(page)) return
    attached.add(page)
    page.on('request', request => {
      const url = new URL(request.url())
      if (['http:', 'https:'].includes(url.protocol) && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
        externalRequests.push({
          origin: url.origin,
          path: url.pathname,
          method: request.method(),
          resourceType: request.resourceType(),
        })
    })
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('response', response => {
      if (response.status() >= 400) responses.push({ url: response.url(), status: response.status() })
    })
  }
  try {
    app = await _electron.launch({
      executablePath: installation.executable,
      args: [...(installation.argsPrefix ?? []), `--user-data-dir=${installation.profileDir}`],
      cwd: installation.installedRoot,
      env,
      timeout: 60000,
    })
    app.on('window', observe)
    app.windows().forEach(observe)
    child = app.process()
    child.stdout?.on('data', data => output.push(data.toString()))
    child.stderr?.on('data', data => output.push(data.toString()))
    page = await app.firstWindow({ timeout: 60000 })
    observe(page)
    page.setDefaultTimeout(30000)
    await page.waitForURL(/^arcadia-client:\/\/app\//, { waitUntil: 'domcontentloaded' })
    const readIdentity = () =>
      app.evaluate(({ app }) => ({
        isPackaged: app.isPackaged,
        appPath: app.getAppPath(),
        userData: app.getPath('userData'),
        sessionData: app.getPath('sessionData'),
        version: app.getVersion(),
        name: app.getName(),
        executable: process.execPath,
        resourcesPath: process.resourcesPath,
        appDir: process.env.APPDIR,
      }))
    const identity = await readIdentity().catch(error => {
      // Playwright can report a transient inspector error on the first main-process evaluation.
      if (!error.message.includes('Execution context was destroyed')) throw error
      console.warn('Retrying installed application identity read:', error.message)
      return readIdentity()
    })
    assert.equal(identity.isPackaged, true)
    assert.match(identity.appPath, /[/\\]app\.asar$/)
    assert.equal(await realpath(identity.userData), await realpath(installation.profileDir))
    assert.equal(await realpath(identity.sessionData), await realpath(installation.profileDir))
    if (sourceProof) {
      const builderRequire = createRequire(require.resolve('electron-builder/package.json'))
      const asar = createRequire(builderRequire.resolve('app-builder-lib/package.json'))('@electron/asar')
      const runtime = join(identity.resourcesPath, 'arcadia-server')
      const actual = {
        mainSha256: hash(asar.extractFile(identity.appPath, 'electron/main.mjs')),
        contentLibrarySha256: hash(asar.extractFile(identity.appPath, 'electron/content-library.mjs')),
        rendererIndexSha256: hash(asar.extractFile(identity.appPath, 'dist/index.html')),
        cliSha256: hash(await readFile(join(runtime, 'cli.js'))),
        serverSha256: hash(await readFile(join(runtime, 'node_modules/@arcadia-eternity/server/dist/index.js'))),
        runtimeManifestSha256: hash(await readFile(join(runtime, 'arcadia-desktop-runtime.json'))),
      }
      assert.deepEqual(actual, sourceProof, 'installed application uses the recorded renderer, main and server inputs')
    }
    errors.push(...(await page.pageErrors()).map(error => error.message))
    consoleErrors.push(
      ...(await page.consoleMessages()).filter(message => message.type() === 'error').map(message => message.text()),
    )
    await page.waitForFunction(() => typeof window.arcadiaDesktop?.prepareLocalContent === 'function')
    localPort = await page.evaluate(() => window.arcadiaDesktop.getLocalServerPort())
    // Verify the installed desktop can prepare its own npm environment and hand off its runtime.
    const content = await page.evaluate(async () => {
      const prepared = await window.arcadiaDesktop.prepareLocalContent()
      try {
        const environment = await window.arcadiaDesktop.readLocalRuntime(prepared.token)
        return {
          species: prepared.content.species.length,
          skills: prepared.content.skills.length,
          environment: environment.revision,
        }
      } finally {
        await window.arcadiaDesktop.releaseLocalContent(prepared.token)
      }
    })
    assert.ok(content.species > 0 && content.skills > 0, 'packaged official content loads')
    assert.match(content.environment, /^arcadia\.work-environment\/1:[a-f0-9]{64}\/effects:[a-f0-9]{64}$/)
    const base = await page.evaluate(async () => {
      const api = window.arcadiaDesktop
      const { packages } = await api.listContentPackages()
      const installed = packages.find(pkg => pkg.bundled)
      const { result: project, error } = await api.author({ action: 'browse-package', packageId: installed.id })
      if (error) throw new Error(error.message)
      try {
        const { result: snapshot } = await api.author({ action: 'snapshot', id: project.id })
        const creator = await api.readCreatorBase()
        return {
          project,
          skillCount: snapshot.records.filter(row => row.kind === 'skills').length,
          creatorSkillCount: creator.data.skills.length,
        }
      } finally {
        await api.author({ action: 'forget', id: project.id })
      }
    })
    assert.equal(base.project.published, true)
    assert.equal(base.project.readOnly, true)
    assert.match(base.project.directory, /[/\\]node_modules[/\\]@arcadia-eternity[/\\]data-pack-base$/)
    assert.equal(base.skillCount, content.skills)
    assert.equal(base.creatorSkillCount, content.skills)
    await expect(page.getByRole('button', { name: /^(当前未连接服务器|已连接.*)，连接设置$/ })).toBeVisible({
      timeout: 90000,
    })
    await expect(page.getByText('初始化失败，请刷新页面重试', { exact: true })).toHaveCount(0)
    await page.goto('arcadia-client://app/account')
    await page.getByRole('heading', { name: '档案与账号', exact: true }).waitFor()
    const name = '安装替换验收'
    if (!baseline) {
      const field = page
        .locator('label')
        .filter({ hasText: /^玩家名称$/ })
        .locator('..')
      await field.getByRole('button').click()
      await field.getByRole('textbox').fill(name)
      await field.getByRole('textbox').press('Enter')
    }
    await expect(page.getByText(name, { exact: true })).toBeVisible()
    const player = await page.evaluate(() => JSON.parse(localStorage.getItem('player-data')))
    assert.ok(player.id)
    assert.equal(player.name, name)
    if (baseline) assert.deepEqual(player, baseline.player)

    await page.goto('arcadia-client://app/content')
    let project
    if (!baseline) {
      await page.getByRole('button', { name: '新建内容包', exact: true }).click()
      await page.getByLabel('内容包名称', { exact: true }).fill('安装保留源项目')
      await page.getByRole('button', { name: '创建并打开', exact: true }).click()
      await page.getByRole('heading', { name: '精灵', exact: true }).waitFor()
      const projects = await page.evaluate(async () => (await window.arcadiaDesktop.author({ action: 'list' })).result)
      assert.equal(projects.length, 1)
      project = projects[0]
      await page.getByRole('navigation', { name: '内容分类' }).getByRole('button', { name: /^技能/ }).click()
      await page.locator('.content-card').filter({ hasText: '霜击' }).click()
      await page.getByLabel('威力', { exact: true }).fill('77')
      await page.getByRole('button', { name: /^查看并保存/ }).click()
      await page.getByRole('button', { name: '确认保存', exact: true }).click()
      await expect(page.getByRole('status').filter({ hasText: /^已保存 \d+ 个源文件/ })).toBeVisible()
    } else {
      const projects = await page.evaluate(async () => (await window.arcadiaDesktop.author({ action: 'list' })).result)
      project = projects.find(item => item.id === baseline.project.id)
      assert.ok(project, 'author source project survives application replacement')
      assert.equal(project.directory, baseline.project.directory)
      await page.goto(`arcadia-client://app/content/edit/${encodeURIComponent(project.id)}`)
      await page.getByRole('navigation', { name: '内容分类' }).getByRole('button', { name: /^技能/ }).click()
      await page.locator('.content-card').filter({ hasText: '霜击' }).click()
      await expect(page.getByLabel('威力', { exact: true })).toHaveValue('77')
    }
    const source = await readFile(join(project.directory, 'data/skills/strike.yaml'))
    assert.match(source.toString(), /power: 77/)
    const sourceSha256 = hash(source)
    if (baseline) assert.equal(sourceSha256, baseline.sourceSha256)

    await page.goto('arcadia-client://app/servers')
    if (baseline) await page.getByRole('button', { name: '使用已保存配置启动', exact: true }).click()
    else {
      await page.getByRole('button', { name: '在本机开服', exact: true }).click()
      await page.getByLabel('谁可以连接').selectOption('local')
      await page.getByRole('button', { name: '启动服务器', exact: true }).click()
    }
    await expect(page.getByRole('button', { name: '进入本机大厅', exact: true })).toBeVisible({ timeout: 90000 })
    host = await page.evaluate(() => window.arcadiaDesktop.getLocalBattleStatus())
    assert.equal(host.status, 'running')
    const request = async (method, path, body) => {
      const response = await page.evaluate(input => window.arcadiaDesktop.managementRequest(input), {
        method,
        path,
        ...(body ? { body } : {}),
      })
      assert.ok(response.status >= 200 && response.status < 300, JSON.stringify(response))
      return response.body
    }
    const capabilities = await request('GET', '/capabilities')
    const server = (await request('GET', '/servers')).servers.find(item => item.id === host.serverId)
    assert.ok(server?.defaultBindingId)
    const binding = (await request('GET', `/servers/${server.id}/bindings`)).bindings.find(
      item => item.id === server.defaultBindingId,
    )
    assert.equal(binding.condition, 'available')
    await page.goto('arcadia-client://app/management?tab=environments')
    if (!baseline) {
      await page.getByRole('button', { name: '新建环境', exact: true }).click()
      const editor = page.getByRole('form', { name: '编辑环境' })
      await editor.getByLabel('名称', { exact: true }).fill('安装保留环境')
      await editor.getByLabel('标识', { exact: true }).fill('installation-persistence')
      await editor.getByRole('button', { name: '保存环境', exact: true }).click()
      await expect(editor).not.toBeVisible()
    }
    const environments = await request('GET', `/workspaces/${capabilities.workspaceId}/environments`)
    assert.match(JSON.stringify(environments), /installation-persistence/)
    const persistent = {
      workspaceId: capabilities.workspaceId,
      serverId: host.serverId,
      bindingId: binding.id,
      versionId: binding.effectiveVersionId,
      environments,
    }
    if (baseline) assert.deepEqual(persistent, baseline.persistent)
    await expect(page.getByText('安装保留环境', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /^(当前未连接服务器|已连接.*)，连接设置$/ })).toBeVisible({
      timeout: 90000,
    })
    await page.screenshot({ path: join(evidenceDirectory, `${label}.png`), fullPage: true })
    assert.deepEqual(errors, [], 'no unhandled renderer errors')
    assert.deepEqual(consoleErrors, [], 'no renderer error logs')
    assert.deepEqual(responses, [], 'no unexpected HTTP errors')
    // The author project may display configured remote images on demand. This
    // scenario is not offline asset acceptance, but must not contact a game or
    // account backend just to edit the local profile or start local hosting.
    assert.deepEqual(
      externalRequests.filter(request => request.resourceType !== 'image'),
      [],
      'local profile, authoring and hosting do not contact external service APIs',
    )
    result = {
      identity,
      content,
      player,
      project: { id: project.id, directory: project.directory },
      sourceSha256,
      persistent,
      hostPort: new URL(host.url).port,
      errors,
      consoleErrors,
      responses,
      externalRequests,
    }
  } catch (error) {
    await page
      ?.screenshot({ path: join(evidenceDirectory, `${label}-failure.png`), fullPage: true, timeout: 3000 })
      .catch(() => {})
    await writeFile(
      join(evidenceDirectory, `${label}-failure.json`),
      JSON.stringify({ error: error.stack, errors, consoleErrors, responses, externalRequests }, null, 2) + '\n',
    )
    throw error
  } finally {
    if (app) {
      host ??= await bounded(
        page?.evaluate(() => window.arcadiaDesktop?.getLocalBattleStatus()),
        2000,
        'Reading host status timed out',
      ).catch(() => undefined)
      let shutdown, shutdownFailure
      try {
        shutdown = await shutdownDesktopProcess({
          child,
          quit: () => app.evaluate(({ app }) => app.quit()),
          ports: [localPort, host?.url ? new URL(host.url).port : undefined],
        })
      } catch (error) {
        shutdownFailure = error
        throw error
      } finally {
        try {
          await writeFile(join(evidenceDirectory, `${label}-process.log`), output.join(''))
        } catch (error) {
          // A failed evidence write must never erase the retention instruction
          // attached to a process tree whose termination remains unproven.
          if (shutdownFailure) shutdownFailure.evidenceWriteError = error
          else throw error
        }
      }
      assert.equal(shutdown.forced, false, 'application exits without forced termination')
      assert.equal(child.exitCode, 0, 'application exits normally')
      if (result) {
        result.exitCode = child.exitCode
        result.exitSignal = child.signalCode
      }
    }
  }
  await writeFile(join(evidenceDirectory, `${label}.json`), JSON.stringify(result, null, 2) + '\n')
  return result
}

const ARCADIA_DEV_SERVER = 'ARCADIA_ELECTRON_DEV_SERVER_URL'

export async function verifyDesktopInstallationReplacement({ artifact, evidenceDirectory }) {
  const workspace = await createDesktopInstallerWorkspace()
  const report = {
    scope: 'same-version artifact replacement; not a public cross-version upgrade',
    artifact,
    workspace: workspace.root,
    launches: [],
  }
  try {
    let baseline
    await workspace.install({
      ...artifact,
      accept: async installation => {
        baseline = await verifyInstalledDesktop(installation, {
          evidenceDirectory,
          label: 'first-install',
          sourceProof: artifact.sourceProof,
        })
        report.launches.push(baseline)
      },
    })
    await workspace.install({
      ...artifact,
      accept: async installation => {
        report.launches.push(
          await verifyInstalledDesktop(installation, {
            evidenceDirectory,
            label: 'replacement',
            baseline,
            sourceProof: artifact.sourceProof,
          }),
        )
      },
    })
    await writeFile(join(evidenceDirectory, 'installation-acceptance.json'), JSON.stringify(report, null, 2) + '\n')
    return report
  } finally {
    await workspace.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [receipt, evidence] = process.argv.slice(2)
  if (!receipt || !evidence)
    throw new Error('Usage: node scripts/verify-desktop-installation.mjs <artifact.json> <evidence-directory>')
  const artifact = JSON.parse(await readFile(resolve(receipt), 'utf8'))
  await verifyDesktopInstallationReplacement({ artifact, evidenceDirectory: resolve(evidence) })
}
