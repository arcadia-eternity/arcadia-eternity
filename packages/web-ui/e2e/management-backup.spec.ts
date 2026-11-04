import { expect, test, type Page } from 'playwright/test'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

// Uses only the production distribution, real host CLI and public UI/API. No route mocks or store injection.
test.skip(process.env.PLAYWRIGHT_MANAGEMENT_BACKUP !== '1', 'Requires freshly built CLI and paired website')

const root = fileURLToPath(new URL('../../../', import.meta.url))
const cli = join(root, 'dist/cli.js')
const run = promisify(execFile)
const environment = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TMPDIR: process.env.TMPDIR,
  STORAGE_DRIVER: 'sqlite',
  ACCOUNT_MODE: 'guest',
}

async function startServer(directory: string, port = 0) {
  const child = spawn(
    process.execPath,
    [
      cli,
      'server',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--data-dir',
      directory,
      '--web-root',
      join(root, 'dist/web'),
      '--web-auto-connect',
      'false',
      '--offline-content',
    ],
    { cwd: directory, env: environment, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let output = ''
  const address = await new Promise<{ port: number; serverId: string }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error('Test server startup timed out'))
    }, 30000)
    const read = (chunk: Buffer) => {
      output += chunk.toString()
      const ready = /Battle server ([\w-]+) listening on port (\d+)/.exec(output)
      if (ready) {
        clearTimeout(timeout)
        resolve({ serverId: ready[1]!, port: Number(ready[2]) })
      }
    }
    child.stdout.on('data', read)
    child.stderr.on('data', read)
    child.once('error', error => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', code => {
      clearTimeout(timeout)
      reject(new Error(`Test server exited before readiness (${code}): ${output.slice(-2000)}`))
    })
  })
  return { child, ...address, origin: `http://127.0.0.1:${address.port}` }
}
async function stopServer(child?: ChildProcess) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const stopped = once(child, 'exit')
  child.kill('SIGTERM')
  const force = setTimeout(() => child.kill('SIGKILL'), 15000)
  try {
    await stopped
  } finally {
    clearTimeout(force)
  }
}
async function hostCommand(directory: string, args: string[]) {
  // Never include stdout in thrown errors: login-code deliberately returns a secret.
  try {
    const { stdout } = await run(process.execPath, [cli, 'server', ...args], {
      cwd: directory,
      env: environment,
      maxBuffer: 1024 * 1024,
    })
    return JSON.parse(stdout.trim())
  } catch {
    throw new Error(`Host CLI ${args.slice(0, 2).join(' ')} failed`)
  }
}
async function login(page: Page, directory: string, origin: string) {
  const credential = await hostCommand(directory, ['admin', 'login-code', '--data-dir', directory])
  const identity = { serverId: String(credential.serverId), workspaceId: String(credential.workspaceId) }
  await page.goto(origin + '/management')
  await expect(page.getByRole('heading', { name: '登录服务器管理', exact: true })).toBeVisible()
  await page.getByLabel('一次性登录码', { exact: true }).fill(credential.code)
  delete credential.code
  await page.getByRole('button', { name: '登录管理', exact: true }).click()
  await expect(page.getByRole('button', { name: '新建环境', exact: true })).toBeEnabled()
  await expect(page.locator('.management-heading')).toContainText(identity.serverId)
  await expect(page.locator('.management-heading')).toContainText(identity.workspaceId)
  return identity
}

test('paired production management backs up, revokes service credentials and retains history after restart', async ({
  browser,
}, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), 'arcadia-management-browser-'))
  let server: Awaited<ReturnType<typeof startServer>> | undefined
  const context = await browser.newContext({ acceptDownloads: true })
  const page = await context.newPage()
  const checks: string[] = []
  const errors: string[] = []
  const unexpectedResponses: { path: string; status: number }[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('response', response => {
    if (response.status() >= 400 && response.status() !== 401)
      unexpectedResponses.push({ path: new URL(response.url()).pathname, status: response.status() })
  })
  let summary: Record<string, unknown> = {}
  try {
    server = await startServer(directory)
    const denied = await context.request.post(`${server.origin}/api/management/v1/servers/${server.serverId}/backup`, {
      data: {},
    })
    expect(denied.status()).toBe(401)
    checks.push('anonymous backup creation rejected')
    const identity = await login(page, directory, server.origin)
    expect(identity.serverId).toBe(server.serverId)
    checks.push('host one-use code claimed through paired production UI')

    await page.getByRole('button', { name: '新建环境', exact: true }).click()
    const editor = page.getByRole('form', { name: '编辑环境' })
    await editor.getByLabel('名称', { exact: true }).fill('备份验收环境')
    await editor.getByLabel('标识', { exact: true }).fill('backup-acceptance')
    await editor.getByRole('button', { name: '保存环境', exact: true }).click()
    await expect(editor).not.toBeVisible()
    await page.getByRole('button', { name: '准备版本', exact: true }).click()
    const preparation = page.locator('.operation').filter({ has: page.getByText('准备环境', { exact: true }) })
    await expect(preparation.getByText('已完成', { exact: true })).toBeVisible({ timeout: 90000 })
    checks.push('real fixed environment prepared for backup materials')

    await page.getByRole('button', { name: '管理员', exact: true }).click()
    await page.getByRole('button', { name: '签发凭证', exact: true }).click()
    const issued = page.getByRole('region', { name: '新签发的凭证' })
    await expect(issued).toBeVisible()
    let token = await issued.getByLabel('凭证', { exact: true }).inputValue()
    const credentialId = await issued.locator('code').innerText()
    // Assert booleans only, so failed assertions cannot print the raw service token.
    expect(token.length > 20).toBe(true)
    const leaked = await page.evaluate(
      value =>
        [...Object.values(localStorage), ...Object.values(sessionStorage)].some(item => String(item).includes(value)),
      token,
    )
    expect(leaked).toBe(false)
    await issued.getByRole('button', { name: '已保存，关闭', exact: true }).click()
    await expect(issued).not.toBeVisible()
    await page.reload()
    await page.getByRole('button', { name: '管理员', exact: true }).click()
    const credentialList = page.getByRole('region', { name: '已有服务凭证' })
    await expect(credentialList).toContainText(credentialId)
    await expect(page.getByRole('region', { name: '新签发的凭证' })).not.toBeVisible()
    await credentialList.screenshot({ path: testInfo.outputPath('credential-metadata.png') })
    checks.push('service token issued once, absent from browser storage, only credential metadata survives reload')

    await page.getByRole('button', { name: '服务器', exact: true }).click()
    await page.getByRole('button', { name: '创建服务器备份', exact: true }).click()
    const backupTask = page.locator('.operation').filter({ has: page.getByText('服务器备份', { exact: true }) })
    await expect(backupTask.getByText('已完成', { exact: true })).toBeVisible({ timeout: 60000 })
    const operationId = await backupTask.locator('small').innerText()
    await backupTask.screenshot({ path: testInfo.outputPath('backup-completed.png') })
    const downloaded = page.waitForEvent('download')
    await backupTask.getByRole('button', { name: '下载服务器备份', exact: true }).click()
    const download = await downloaded
    const archiveText = await readFile((await download.path())!, 'utf8')
    const archive = JSON.parse(archiveText)
    expect(archive.format).toBe('arcadia.server-backup/1')
    expect(archive.serverId).toBe(identity.serverId)
    expect(archive.workspace.workspaceId).toBe(identity.workspaceId)
    expect(
      archive.workspace.drafts.some((draft: { document: { id: string } }) => draft.document.id === 'backup-acceptance'),
    ).toBe(true)
    expect(archive.workspace.versions.length).toBe(1)
    expect(archive.workspace.versions[0].files.length).toBeGreaterThan(0)
    expect(Array.isArray(archive.storage.accounts)).toBe(true)
    expect(archive.storage.records.credentials).toEqual([])
    expect(archive.storage.records.sessions).toEqual([])
    expect(archiveText.includes(token)).toBe(false)
    token = ''
    // Save only after proving active credential material was omitted.
    const archivePath = testInfo.outputPath('server-backup.json')
    await download.saveAs(archivePath)
    const inspected = await hostCommand(directory, ['backup', 'inspect', '--file', archivePath])
    expect(inspected).toMatchObject({
      serverId: identity.serverId,
      workspaceId: identity.workspaceId,
      servers: 1,
      environments: 1,
      versions: 1,
      accounts: 0,
    })
    checks.push(
      'manual download contains original identity and prepared materials, excludes active credentials, passes host offline inspection',
    )

    await page.getByRole('button', { name: '管理员', exact: true }).click()
    await credentialList
      .locator('article')
      .filter({ hasText: credentialId })
      .getByRole('button', { name: '撤销此凭证', exact: true })
      .click()
    await page
      .getByRole('group', { name: '确认撤销凭证' })
      .getByRole('button', { name: '确认撤销', exact: true })
      .click()
    await expect(credentialList.locator('article').filter({ hasText: credentialId })).toHaveCount(0)
    checks.push('service credential revoked through metadata UI')

    // Keep a second credential active to distinguish durable listing from an empty-list restart.
    await page.getByRole('button', { name: '签发凭证', exact: true }).click()
    await expect(issued).toBeVisible()
    const survivingCredentialId = await issued.locator('code').innerText()
    await issued.getByRole('button', { name: '已保存，关闭', exact: true }).click()
    await expect(issued).not.toBeVisible()

    await page.getByRole('button', { name: '退出管理', exact: true }).click()
    await expect(page.getByRole('heading', { name: '登录服务器管理', exact: true })).toBeVisible()
    const port = server.port
    await stopServer(server.child)
    server = await startServer(directory, port)
    const restored = await login(page, directory, server.origin)
    expect(restored).toEqual(identity)
    await expect(page.getByRole('heading', { name: '备份验收环境', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '管理员', exact: true }).click()
    await expect(credentialList).toContainText(survivingCredentialId)
    await expect(credentialList.locator('article').filter({ hasText: credentialId })).toHaveCount(0)
    await credentialList.screenshot({ path: testInfo.outputPath('credential-metadata-after-restart.png') })
    await credentialList
      .locator('article')
      .filter({ hasText: survivingCredentialId })
      .getByRole('button', { name: '撤销此凭证', exact: true })
      .click()
    await page
      .getByRole('group', { name: '确认撤销凭证' })
      .getByRole('button', { name: '确认撤销', exact: true })
      .click()
    await expect(credentialList).not.toBeVisible()
    await page.getByRole('button', { name: /^任务/ }).click()
    await expect(backupTask).toContainText(operationId)
    await expect(backupTask.getByText('已完成', { exact: true })).toBeVisible()
    const repeatedDownload = page.waitForEvent('download')
    await backupTask.getByRole('button', { name: '下载服务器备份', exact: true }).click()
    const repeated = JSON.parse(await readFile((await (await repeatedDownload).path())!, 'utf8'))
    expect(repeated.createdAt).toBe(archive.createdAt)
    expect(repeated.serverId).toBe(identity.serverId)
    await backupTask.screenshot({ path: testInfo.outputPath('backup-after-restart.png') })
    checks.push(
      'restart preserves identity, environment listing, active credential metadata, credential revocation and completed backup download history',
    )
    expect(errors).toEqual([])
    expect(unexpectedResponses).toEqual([])
    summary = {
      passed: true,
      identity,
      operationId,
      backup: inspected,
      checks,
      errors,
      unexpectedResponses,
      accountMode: 'guest; durable account preservation covered by storage backup integration tests',
    }
  } finally {
    await context.close()
    await stopServer(server?.child)
    await rm(directory, { recursive: true, force: true })
    await writeFile(
      testInfo.outputPath('acceptance.json'),
      JSON.stringify({ passed: false, checks, errors, unexpectedResponses, ...summary }, null, 2),
    )
  }
})
