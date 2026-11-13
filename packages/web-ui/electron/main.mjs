import { app, BrowserWindow, Menu, shell, ipcMain, dialog, session } from 'electron'
import { createRequire } from 'node:module'
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promises as fs } from 'node:fs'
import { LocalBattleHost } from './local-battle-host.mjs'
import { LocalServerController } from './local-server-controller.mjs'
import { isTrustedDesktopRequest } from './local-battle-ipc.mjs'
import { createRemotePlayController, protectDesktopNavigation, normalizeRemoteBackend } from './remote-play.mjs'
import { createSwfHost } from './swf-host.mjs'
import { CLIENT_URL, CLIENT_ORIGIN, registerClientProtocol } from './client-protocol.mjs'
import { stopForQuit } from './shutdown.mjs'
import { ContentProjectManager, runContentCommand } from './content-projects.mjs'
import { ContentLibrary } from './content-library.mjs'
import { createAuthorPreviewSessions } from './author-preview-sessions.mjs'
import { notifyAuthorPreviewChange } from './author-preview-events.mjs'
import { AuthorWorkspaces } from './author-workspaces.mjs'
import { createLocalContentSessions } from './local-content-sessions.mjs'
import { bindLocalContentOwner } from './local-content-owner.mjs'
import { LocalEnvironments } from './local-environments.mjs'
import { DesktopWorkspaceOwner } from './desktop-workspace-owner.mjs'
import { protectStandardStreams } from './stdio.mjs'

protectStandardStreams()

const require = createRequire(import.meta.url)
const { autoUpdater } = require('electron-updater')

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const rendererDistDir = path.join(projectRoot, 'dist')
const preloadPath = path.join(__dirname, 'preload.cjs')
const devServerUrl = process.env.ARCADIA_ELECTRON_DEV_SERVER_URL
const rendererUrl = devServerUrl ?? CLIENT_URL
// Main-process content preparation uses the bundled npm entry too. Child invocations
// set Electron's Node mode themselves; do not alter app relaunch semantics globally.
if (app.isPackaged)
  process.env.ARCADIA_NPM_CLI = path.join(process.resourcesPath, 'arcadia-server/runtime/npm/bin/npm-cli.js')
const localBattleHost = new LocalBattleHost({
  executable: process.execPath,
  cli: app.isPackaged
    ? path.join(process.resourcesPath, 'arcadia-server', 'cli.js')
    : path.resolve(projectRoot, '../../dist/cli.js'),
  webRoot: app.isPackaged
    ? path.join(process.resourcesPath, 'arcadia-server', 'web')
    : path.resolve(projectRoot, '../../dist/web'),
  rendererOrigin: devServerUrl ? new URL(devServerUrl).origin : CLIENT_ORIGIN,
  stateDirectory: path.join(app.getPath('userData'), 'local-server'),
  workspaceRoot: path.join(app.getPath('userData'), 'content-packages'),
  attachWorkspace: child => getManagementWorkspaceOwner().attach(child),
  ...(app.isPackaged
    ? {
        npmCliPath: path.join(process.resourcesPath, 'arcadia-server', 'runtime', 'npm', 'bin', 'npm-cli.js'),
        packsDirectory: path.join(process.resourcesPath, 'arcadia-server', 'packs'),
      }
    : {}),
})

const localServerController = new LocalServerController({
  host: localBattleHost,
  library: getContentLibrary,
  startProject: id => getContentProjects().start(id),
})

const PET_REMOTE_BASE = 'https://seer2-pet-resource.yuuinih.com/public/fight'

let personalProfile
let personalProfileBusy = true
async function getPersonalProfile() {
  if (!personalProfile)
    personalProfile = (async () => {
      const runtimeRequire = app.isPackaged
        ? createRequire(path.join(process.resourcesPath, 'arcadia-server/package.json'))
        : require
      const { ProfileRepository, validateEnvelope, validateData } = await import(
        pathToFileURL(runtimeRequire.resolve('@arcadia-eternity/local-profile')).href
      )
      const { FileProfileStorage } = await import(
        pathToFileURL(runtimeRequire.resolve('@arcadia-eternity/local-profile/node')).href
      )
      const storage = new FileProfileStorage(path.join(app.getPath('userData'), 'profile'))
      await storage.acquireOwner()
      return { storage, repository: new ProfileRepository(storage), validateEnvelope, validateData }
    })().catch(error => {
      personalProfile = undefined
      throw error
    })
  return personalProfile
}
const remotePlay = createRemotePlayController({
  validateProfile: value => {
    if (JSON.stringify(value).length > 20 * 1024 * 1024) throw new Error('Profile too large')
    return structuredClone(value)
  },
  confirmProfileClose: async window => {
    const result = await dialog.showMessageBox(window, {
      type: 'question',
      message: '远程窗口有未保存修改',
      buttons: ['取消', '保存到个人资料', '放弃修改'],
      defaultId: 0,
      cancelId: 0,
    })
    return ['cancel', 'save', 'discard'][result.response]
  },
  readProfile: async () => (await (await getPersonalProfile()).repository.open())?.current ?? null,
  saveProfile: async input => {
    if (personalProfileBusy) throw new Error('请先在主窗口退出房间、匹配或对局')
    const { repository, validateData } = await getPersonalProfile()
    const data = validateData(input?.data)
    const preview = await repository.inspectImport(JSON.stringify(await repository.exportBackup(data)))
    if (preview.expectedRevision !== input.expectedRevision) throw new Error('个人资料已改变，请重新打开远程窗口')
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error('主窗口不可用')
    const answer = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      message: '保存远程窗口的个人资料？',
      detail: `昵称：${preview.current?.data.profile.name ?? '—'} → ${data.profile.name}\n仓库：${preview.current?.data.library.storage.length ?? 0} → ${data.library.storage.length}\n队伍：${preview.current?.data.library.teams.length ?? 0} → ${data.library.teams.length}\n设置变化：${Object.keys(data.settings).filter(key => JSON.stringify(data.settings[key]) !== JSON.stringify(preview.current?.data.settings[key])).length} 项`,
      buttons: ['取消', '保存资料'],
      defaultId: 0,
      cancelId: 0,
    })
    if (answer.response !== 1) throw new Error('已取消保存')
    if (personalProfileBusy) throw new Error('请先在主窗口退出房间、匹配或对局')
    const result = await repository.commitImport({ ...preview, decision: 'restore' })
    mainWindow.webContents.send('desktop:profile-changed')
    return result
  },
  BrowserWindow,
  session,
  rendererUrl,
  preload: path.join(__dirname, 'remote-preload.cjs'),
  setupSession: isolated => {
    if (!devServerUrl) registerClientProtocol(isolated, rendererDistDir)
  },
  isManagementUrl: value => {
    try {
      const url = new URL(value)
      return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && Number(url.port) === localServerPort
    } catch {
      return true
    }
  },
})
const swfHost = createSwfHost({
  isTrustedController: event =>
    isTrustedDesktopRequest(event, mainWindow?.webContents, rendererUrl) || remotePlay.isTrusted(event),
  playerPath: path.join(projectRoot, devServerUrl ? 'public/swf-player.html' : 'dist/swf-player.html'),
  runtimeDirectory: path.join(projectRoot, devServerUrl ? 'node_modules/@ruffle-rs/ruffle' : 'dist/ruffle'),
})
const managementHttpToken = randomUUID()
let mainWindow = null
let localServer = null
let localServerPort = null
let petsDir = null
let contentProjects
let contentLibrary
let managementWorkspaceOwner
let localContentSessions
let localContentRuntime
let localContentOwner
let authorWorkspaces
const authorPreviewWindows = new Map()
const authorPreviewProjects = new WeakMap()
let previewOperation = Promise.resolve()
function withPreviewOperation(operation) {
  const next = previewOperation.catch(() => {}).then(operation)
  previewOperation = next
  return next
}
const previewSession = createAuthorPreviewSessions({ directory: rendererDistDir, development: !!devServerUrl })
ipcMain.on('author-preview:return', event => {
  const window = [...authorPreviewWindows.values()].find(window =>
    isTrustedDesktopRequest(event, window.webContents, rendererUrl),
  )
  if (!window) return
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
  window.close()
})
async function openAuthorPreview(id, job) {
  if (job.kind !== 'preview' || job.state !== 'succeeded' || !job.result?.preview?.endpoint)
    throw new Error('请先为当前源项目准备可用的画面试玩')
  const key = `${id}:${job.jobId}`
  const previous = authorPreviewWindows.get(key)
  if (previous && !previous.isDestroyed()) {
    previous.focus()
    return
  }
  const isolated = previewSession(key)
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    backgroundColor: '#09131f',
    title: '内容包试玩',
    webPreferences: {
      session: isolated,
      preload: path.join(__dirname, 'preview-preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })
  window.once('ready-to-show', () => window.show())
  authorPreviewWindows.set(key, window)
  authorPreviewProjects.set(window.webContents, id)
  protectDesktopNavigation(window, rendererUrl)
  window.on('closed', () => {
    authorPreviewWindows.delete(key)
    void isolated.closeAllConnections()
  })
  const url = new URL('/content/preview', rendererUrl)
  url.searchParams.set('endpoint', job.result.preview.endpoint)
  try {
    await window.loadURL(url.href)
  } catch (error) {
    window.destroy()
    throw error
  }
}
function getAuthorWorkspaces() {
  authorWorkspaces ??= new AuthorWorkspaces({
    root: path.join(app.getPath('userData'), 'ugc'),
    api: () =>
      import(
        app.isPackaged
          ? pathToFileURL(
              path.join(
                process.resourcesPath,
                'arcadia-server/node_modules/@arcadia-eternity/content-sdk/dist/author-api.js',
              ),
            ).href
          : '@arcadia-eternity/content-sdk/workspace'
      ),
    notify: event => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('desktop:author-changed', event)
      notifyAuthorPreviewChange(authorPreviewWindows.values(), authorPreviewProjects, event)
    },
    env: {
      ...process.env,
      ARCADIA_PREVIEW_CLIENT_URL: rendererUrl,
      ...(app.isPackaged
        ? { ARCADIA_NPM_CLI: path.join(process.resourcesPath, 'arcadia-server/runtime/npm/bin/npm-cli.js') }
        : {}),
    },
  })
  return authorWorkspaces
}
function getContentLibrary() {
  contentLibrary ??= new ContentLibrary({
    root: path.join(app.getPath('userData'), 'content-packages'),
    host: localBattleHost,
    withDefaultArchive: async use => {
      const runtimeRequire = app.isPackaged
        ? createRequire(path.join(process.resourcesPath, 'arcadia-server/package.json'))
        : require
      const { withShippedCatalogArchive } = await import(
        pathToFileURL(runtimeRequire.resolve('@arcadia-eternity/pack-loader/node')).href
      )
      const root = path.dirname(runtimeRequire.resolve('@arcadia-eternity/data-pack-base/package.json'))
      return withShippedCatalogArchive(root, localBattleHost.npmCliPath, use)
    },
    prepare: options => getLocalContentSessions().prepareProject(options),
    selected: options => getLocalContentSessions().selectProject(options),
    createManagedProjects: async (root, options) => {
      const runtimeRequire = app.isPackaged
        ? createRequire(path.join(process.resourcesPath, 'arcadia-server/package.json'))
        : require
      const { ManagedProjects } = await import(
        pathToFileURL(runtimeRequire.resolve('@arcadia-eternity/content-sdk/managed-projects')).href
      )
      return new ManagedProjects(root, options)
    },
    run: (args, signal) =>
      runContentCommand(
        {
          ...localBattleHost,
          npmCacheDirectory: path.join(app.getPath('userData'), 'npm-content-cache'),
        },
        args,
        signal,
      ),
  })
  return contentLibrary
}
let localEnvironments
function getLocalEnvironments() {
  const runtimeRequire = app.isPackaged
    ? createRequire(path.join(process.resourcesPath, 'arcadia-server/package.json'))
    : require
  localEnvironments ??= new LocalEnvironments({
    library: getContentLibrary(),
    setPackageEnabled: async (workspace, input) => {
      const { setEnvironmentPackageEnabled } = await import(
        pathToFileURL(runtimeRequire.resolve('@arcadia-eternity/content-sdk/management-workspace')).href
      )
      return setEnvironmentPackageEnabled(workspace, input)
    },
    openWorkspace: async () => {
      const { ContentWorkspace } = await import(
        pathToFileURL(runtimeRequire.resolve('@arcadia-eternity/content-sdk/management-workspace')).href
      )
      // Server publication always imports a separate copy, so only local runtime
      // leases can retain versions in this independently owned workspace.
      return ContentWorkspace.open(path.join(app.getPath('userData'), 'local-environments'), {
        retentions: { list: async () => [] },
      })
    },
    validate: async input => {
      const { validateWorkspaceProject } = await import(
        pathToFileURL(runtimeRequire.resolve('@arcadia-eternity/server')).href
      )
      return validateWorkspaceProject(input)
    },
  })
  return localEnvironments
}
function getManagementWorkspaceOwner() {
  managementWorkspaceOwner ??= new DesktopWorkspaceOwner({
    root: path.join(app.getPath('userData'), 'content-packages'),
    library: getContentLibrary(),
    openWorkspace: async (root, options) => {
      const runtimeRequire = app.isPackaged
        ? createRequire(path.join(process.resourcesPath, 'arcadia-server/package.json'))
        : require
      const { ContentWorkspace } = await import(
        pathToFileURL(runtimeRequire.resolve('@arcadia-eternity/content-sdk/management-workspace')).href
      )
      return ContentWorkspace.open(root, options)
    },
  })
  return managementWorkspaceOwner
}
async function loadLocalContentRuntime() {
  localContentRuntime ??= (async () => {
    const runtimeRequire = app.isPackaged
      ? createRequire(path.join(process.resourcesPath, 'arcadia-server/package.json'))
      : require
    const load = spec => import(pathToFileURL(runtimeRequire.resolve(spec)).href)
    const [node, native] = await Promise.all([
      load('@arcadia-eternity/pack-loader/node'),
      load('@arcadia-eternity/pack-loader/native'),
    ])
    return {
      host: node.emptyNpmContentHost,
      prepareNpmProject: node.prepareNpmProject,
      buildDisplayCatalog: native.buildDisplayCatalog,
      buildDisplayLocales: native.buildDisplayLocales,
    }
  })().catch(error => {
    localContentRuntime = undefined
    throw error
  })
  return localContentRuntime
}
function getLocalContentSessions() {
  localContentSessions ??= createLocalContentSessions({
    library: getContentLibrary(),
    load: loadLocalContentRuntime,
    assetUrl: (token, hash) => `http://127.0.0.1:${localServerPort}/local-content/${token}/${hash}`,
  })
  return localContentSessions
}
function getContentProjects() {
  contentProjects ??= new ContentProjectManager({
    file: path.join(app.getPath('userData'), 'content-projects.json'),
    host: localBattleHost,
    run: (args, signal) => runContentCommand(localBattleHost, args, signal),
  })
  return contentProjects
}
function buildContextMenuTemplate(window, params) {
  const template = []
  const editFlags = params.editFlags ?? {}
  const hasSelection = typeof params.selectionText === 'string' && params.selectionText.trim().length > 0

  if (!params.isEditable) {
    if (hasSelection) {
      template.push({ role: 'copy' })
    }
    template.push({ role: 'selectAll' })
    return template
  }

  const suggestions = Array.isArray(params.dictionarySuggestions) ? params.dictionarySuggestions.slice(0, 6) : []
  for (const suggestion of suggestions) {
    template.push({
      label: suggestion,
      click: () => window.webContents.replaceMisspelling(suggestion),
    })
  }

  const misspelledWord = typeof params.misspelledWord === 'string' ? params.misspelledWord.trim() : ''
  if (misspelledWord.length > 0) {
    if (template.length > 0) template.push({ type: 'separator' })
    template.push({
      label: 'Add to Dictionary',
      click: () => window.webContents.session.addWordToSpellCheckerDictionary(misspelledWord),
    })
  }

  if (template.length > 0) template.push({ type: 'separator' })
  template.push(
    { role: 'undo', enabled: editFlags.canUndo ?? true },
    { role: 'redo', enabled: editFlags.canRedo ?? true },
    { type: 'separator' },
    { role: 'cut', enabled: editFlags.canCut ?? true },
    { role: 'copy', enabled: editFlags.canCopy ?? true },
    { role: 'paste', enabled: editFlags.canPaste ?? true },
    { role: 'delete', enabled: editFlags.canDelete ?? true },
    { type: 'separator' },
    { role: 'selectAll' },
  )

  return template
}

async function isEditorContextAtPoint(window, x, y) {
  const safeX = Number.isFinite(x) ? Math.max(0, Math.floor(x)) : 0
  const safeY = Number.isFinite(y) ? Math.max(0, Math.floor(y)) : 0

  try {
    const isEditorContext = await window.webContents.executeJavaScript(
      `(() => {
        const target = document.elementFromPoint(${safeX}, ${safeY})
        if (!target || typeof target.closest !== 'function') return false
        return Boolean(target.closest('.monaco-editor, [data-editor-context-menu="true"]'))
      })()`,
      true,
    )
    return Boolean(isEditorContext)
  } catch {
    return false
  }
}

function setupContextMenu(window) {
  window.webContents.on('context-menu', (_event, params) => {
    void (async () => {
      const isEditorContext = await isEditorContextAtPoint(window, params.x, params.y)
      if (!isEditorContext) return

      const template = buildContextMenuTemplate(window, params)
      if (template.length === 0) return
      const menu = Menu.buildFromTemplate(template)
      menu.popup({ window })
    })()
  })
}

function detectContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase()
  switch (extension) {
    case '.json':
      return 'application/json'
    case '.yaml':
    case '.yml':
      return 'application/yaml'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.mp3':
      return 'audio/mpeg'
    case '.swf':
      return 'application/x-shockwave-flash'
    default:
      return 'application/octet-stream'
  }
}

function hasTraversalSegment(value) {
  const normalized = String(value ?? '')
    .replace(/\\/g, '/')
    .split('/')
  return normalized.some(segment => segment === '..')
}

async function pathExists(target) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

function sendResponse(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    ...headers,
  })
  res.end(body)
}

function sendJson(res, statusCode, payload) {
  sendResponse(res, statusCode, Buffer.from(JSON.stringify(payload)), {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  })
}

async function sendFile(res, filePath) {
  const content = await fs.readFile(filePath)
  sendResponse(res, 200, content, {
    'Content-Type': detectContentType(filePath),
    'Cache-Control': 'no-store',
  })
}

async function ensureAppDataDirs() {
  const userDataDir = app.getPath('userData')
  petsDir = path.join(userDataDir, 'pets')

  await fs.mkdir(petsDir, { recursive: true })
}

async function downloadFileToCache(url, filePath) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`下载失败，HTTP状态码: ${response.status}`)
  }

  const bytes = Buffer.from(await response.arrayBuffer())
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, bytes)
}

async function downloadPetSwf(petNum, remoteUrl) {
  if (!petsDir) throw new Error('pets directory unavailable')

  const number = Number(petNum)
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error('petNum 非法')
  }

  const filePath = path.join(petsDir, `${number}.swf`)
  if (await pathExists(filePath)) {
    return filePath
  }

  if (remoteUrl !== `${PET_REMOTE_BASE}/${number}.swf`) throw new Error('Unsupported legacy pet resource URL')
  await downloadFileToCache(remoteUrl, filePath)
  return filePath
}

async function listCachedPets() {
  if (!petsDir) return []

  const entries = await fs.readdir(petsDir, { withFileTypes: true })
  return entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.swf'))
    .map(entry => Number.parseInt(entry.name.replace(/\.swf$/i, ''), 10))
    .filter(value => Number.isFinite(value))
}

async function clearPetCache() {
  if (!petsDir) return

  await fs.rm(petsDir, { recursive: true, force: true })
  await fs.mkdir(petsDir, { recursive: true })
}

function isPortAvailable(port) {
  return new Promise(resolve => {
    const server = net.createServer()

    server.once('error', () => {
      resolve(false)
    })

    server.once('listening', () => {
      server.close(() => resolve(true))
    })

    server.listen(port, '127.0.0.1')
  })
}

async function findAvailablePort(start = 8103, end = 8200) {
  for (let port = start; port < end; port += 1) {
    const available = await isPortAvailable(port)
    if (available) {
      return port
    }
  }
  return null
}

function resolvePetFilePath(fileName) {
  if (!petsDir) return null
  const rawName = String(fileName ?? '')
  if (!rawName || rawName.includes('/') || rawName.includes('\\') || hasTraversalSegment(rawName)) {
    return null
  }

  const candidate = path.join(petsDir, rawName)
  const relative = path.relative(petsDir, candidate)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null
  }

  return candidate
}

async function handleLocalServerRequest(req, res) {
  if (!req.url) {
    sendJson(res, 400, { error: 'invalid request' })
    return
  }

  if (req.method === 'OPTIONS') {
    sendResponse(res, 204, Buffer.alloc(0))
    return
  }

  // The local file endpoint is a manager capability, not a public loopback resource server.
  if (req.headers['x-arcadia-management'] !== managementHttpToken) {
    sendJson(res, 403, { error: 'unauthorized desktop resource request' })
    return
  }

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'method not allowed' })
    return
  }

  let pathname = '/'
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname)
  } catch {
    sendJson(res, 400, { error: 'invalid url' })
    return
  }

  const localAsset = /^\/local-content\/([a-f0-9-]{36})\/([a-f0-9]{64})$/.exec(pathname)
  if (localAsset) {
    const asset = localContentSessions?.assetFile(localAsset[1], localAsset[2])
    if (!asset) return sendJson(res, 404, { error: 'local content session expired' })
    await sendFile(res, asset.file)
    return
  }

  if (pathname.startsWith('/cache/pets/')) {
    const fileName = pathname.slice('/cache/pets/'.length)
    const filePath = resolvePetFilePath(fileName)
    if (!filePath) {
      sendJson(res, 404, { error: 'not found' })
      return
    }

    if (!(await pathExists(filePath))) {
      const matched = fileName.match(/^(\d+)\.swf$/i)
      if (matched) {
        const petNum = Number(matched[1])
        const remoteUrl = `${PET_REMOTE_BASE}/${petNum}.swf`

        try {
          await downloadFileToCache(remoteUrl, filePath)
        } catch {
          sendJson(res, 404, { error: 'not found' })
          return
        }
      }
    }

    if (!(await pathExists(filePath))) {
      sendJson(res, 404, { error: 'not found' })
      return
    }

    await sendFile(res, filePath)
    return
  }

  sendJson(res, 404, { error: 'not found' })
}

async function startLocalServer() {
  const port = await findAvailablePort()
  if (!port) {
    throw new Error('无法找到可用端口')
  }

  localServerPort = port

  localServer = http.createServer((req, res) => {
    void handleLocalServerRequest(req, res).catch(error => {
      console.error('Local server request failed:', error)
      sendJson(res, 500, { error: 'internal server error' })
    })
  })

  await new Promise((resolve, reject) => {
    localServer.once('error', reject)
    localServer.listen(port, '127.0.0.1', () => resolve(undefined))
  })

  console.log(`Local desktop server started at http://127.0.0.1:${port}`)
}

async function stopLocalServer() {
  if (!localServer) return
  await new Promise(resolve => {
    localServer.close(() => resolve(undefined))
  })
  localServer = null
  localServerPort = null
}

async function checkForUpdates() {
  if (!app.isPackaged) {
    return { hasUpdate: false }
  }

  try {
    await fs.access(path.join(process.resourcesPath, 'app-update.yml'))
  } catch (error) {
    if (error.code === 'ENOENT') return { hasUpdate: false }
    throw error
  }

  const result = await autoUpdater.checkForUpdates()
  const version = result?.updateInfo?.version
  const hasUpdate = typeof version === 'string' && version.length > 0 && version !== app.getVersion()

  return hasUpdate ? { hasUpdate: true, version } : { hasUpdate: false }
}

async function downloadAndInstallUpdate() {
  if (!app.isPackaged) {
    throw new Error('仅在打包版本支持自动更新')
  }

  await autoUpdater.downloadUpdate()
  autoUpdater.quitAndInstall()
}

function setupIpcHandlers() {
  // Every manager handler, including legacy workspace/download/updater APIs, shares this guard.
  const handle = (channel, handler) =>
    ipcMain.handle(channel, (event, ...args) => {
      requireLocalBattleCaller(event)
      return handler(event, ...args)
    })
  handle('desktop:profile', async (_event, input) => {
    try {
      if (input?.action === 'activity') {
        personalProfileBusy = input.busy !== false
        return { value: true }
      }
      const { storage, validateEnvelope } = await getPersonalProfile()
      if (input?.action === 'read') return { value: await storage.read() }
      if (input?.action === 'raw') return { value: await storage.readRaw() }
      if (input?.action !== 'commit') throw new Error('Invalid profile action')
      const next = await validateEnvelope(input.next)
      if (
        next.current.revision !==
        (typeof input.expected === 'object' && input.expected !== null ? 1 : (input.expected ?? 0) + 1)
      )
        throw new Error('Invalid profile revision')
      await storage.commit(input.expected, next)
      return { value: true }
    } catch (error) {
      return { error: { code: error.code ?? 'STORAGE_DENIED', message: error.message } }
    }
  })
  handle('desktop:local-server', (_event, input) => localServerController.request(input))
  handle('desktop:local-environment', async (_event, input) => {
    try {
      return { result: await getLocalEnvironments().request(input) }
    } catch (error) {
      return { error: { code: error.code ?? 'ENVIRONMENT_FAILED', message: error.message ?? '环境操作失败' } }
    }
  })
  handle('desktop:management-request', (_event, input) => localBattleHost.managementRequest(input))
  ipcMain.handle('author-preview:environment', async (event, action, input) => {
    const window = [...authorPreviewWindows.values()].find(window =>
      isTrustedDesktopRequest(event, window.webContents, rendererUrl),
    )
    if (!window) throw new Error('Unauthorized preview frame')
    const id = authorPreviewProjects.get(window.webContents),
      manager = getAuthorWorkspaces()
    if (action === 'list' || action === 'save') return manager.debugEnvironments(id, action, input)
    if (action === 'add-source') {
      const choice = await dialog.showOpenDialog(window, { title: '选择额外测试源码包', properties: ['openDirectory'] })
      if (window.isDestroyed() || !isTrustedDesktopRequest(event, window.webContents, rendererUrl))
        throw new Error('Preview closed')
      return choice.canceled ? null : manager.mapDebugSource(id, choice.filePaths[0])
    }
    if (action !== 'prepare' || typeof input?.environmentId !== 'string') throw new Error('环境操作无效')
    // Reply before destroying the caller; the job and output remain owned by the editor.
    setImmediate(() => {
      void withPreviewOperation(async () => {
        const session = await manager.session(id)
        for (const candidate of authorPreviewWindows.values()) candidate.destroy()
        await manager.stopPreviews()
        await previewSession.clear()
        await manager.previewEnvironment(id, input.environmentId)
        const started = await session.jobs.start({ kind: 'preview', environmentId: input.environmentId })
        let job = started
        while (['queued', 'running'].includes(job.state)) {
          await new Promise(resolve => setTimeout(resolve, 100))
          job = session.jobs.get(started.jobId)
        }
        if (job.state === 'succeeded') await openAuthorPreview(id, job)
        else if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show()
          mainWindow.focus()
        }
      }).catch(error => {
        console.error('环境准备失败', error)
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show()
      })
    })
    return { preparing: true }
  })
  ipcMain.handle('author-preview:teams', async (event, action, input) => {
    const window = [...authorPreviewWindows.values()].find(window =>
      isTrustedDesktopRequest(event, window.webContents, rendererUrl),
    )
    if (!window) throw new Error('Unauthorized preview frame')
    // Identity comes from the owning window; the renderer cannot choose a project or path.
    return getAuthorWorkspaces().teamLibrary(authorPreviewProjects.get(window.webContents), action, input)
  })
  ipcMain.handle('remote-play:get-boot-config', event => remotePlay.getBootConfig(event))
  ipcMain.handle('remote-play:profile-draft', (event, input) => remotePlay.updateProfileDraft(event, input))
  ipcMain.handle('remote-play:save-profile', (event, input) => remotePlay.saveProfile(event, input))
  ipcMain.handle('remote-play:close', event => remotePlay.close(event))
  handle('desktop:open-server-website', (_event, input) => shell.openExternal(normalizeRemoteBackend(input?.url)))
  handle('desktop:open-remote-play', (_event, input) => remotePlay.open(input?.url, { mode: input?.mode }))
  handle('desktop:get-backend-config', () => ({ schemaVersion: 1, backendOrigin: 'https://test-battle.fly.dev' }))
  function requireLocalBattleCaller(event) {
    if (!isTrustedDesktopRequest(event, mainWindow?.webContents, rendererUrl))
      throw new Error('Unauthorized desktop frame')
  }
  handle('desktop:author', async (event, input) => {
    try {
      if (!input || typeof input.action !== 'string') throw new Error('作者操作无效')
      const manager = getAuthorWorkspaces()
      let result
      if (input.action === 'list') result = await manager.list()
      else if (input.action === 'browse-package') {
        const directory = await getContentLibrary().sourceDirectory(input.packageId)
        result = await manager.add(directory, { readOnly: true, published: true })
      } else if (input.action === 'create') result = await manager.create(input.name)
      else if (input.action === 'open') {
        const choice = await dialog.showOpenDialog(mainWindow, {
          title: '打开内容包源项目',
          properties: ['openDirectory'],
        })
        requireLocalBattleCaller(event)
        result = choice.canceled ? null : await manager.add(choice.filePaths[0])
      } else {
        if (typeof input.id !== 'string') throw new Error('项目标识无效')
        if (input.action === 'forget') result = await manager.forget(input.id)
        else if (input.action === 'close') result = await manager.release(input.id, { preservePreviews: true })
        else if (input.action === 'export') {
          const choice = await dialog.showSaveDialog(mainWindow, {
            title: '导出完整源项目到新目录',
            buttonLabel: '导出项目',
          })
          requireLocalBattleCaller(event)
          result = choice.canceled ? null : await manager.export(input.id, choice.filePath)
        } else {
          const session = await manager.session(input.id)
          switch (input.action) {
            case 'install-built-author-pack':
              result = await manager.installBuiltPack(input.id, input.jobId, file =>
                getContentLibrary().installFile(file),
              )
              break
            case 'import-asset': {
              await session.workspace.assertWritable()
              const choice = await dialog.showOpenDialog(mainWindow, {
                title: '导入素材到当前内容包',
                properties: ['openFile'],
                filters: [
                  { name: '图片、音频与动画', extensions: ['png', 'jpg', 'jpeg', 'webp', 'mp3', 'ogg', 'swf'] },
                ],
              })
              requireLocalBattleCaller(event)
              result = choice.canceled ? null : await manager.importAsset(input.id, choice.filePaths[0])
              break
            }
            case 'context':
              result = await manager.setContext(input.id, input.state)
              break
            case 'snapshot':
              result = await session.workspace.snapshot()
              break
            case 'save-changes':
              result = await session.workspace.saveChanges(input, { fromForm: true })
              break
            case 'dirty':
              session.workspace.setDirty(input.file, input.dirty === true)
              break
            case 'jobs':
              await session.jobs.refresh()
              result = session.jobs.list()
              break
            case 'start':
              result =
                input.kind === 'preview'
                  ? await withPreviewOperation(async () => {
                      for (const window of authorPreviewWindows.values()) window.destroy()
                      await manager.stopPreviews()
                      await previewSession.clear()
                      return session.jobs.start({
                        kind: 'preview',
                        environmentId: await manager.previewEnvironment(input.id),
                      })
                    })
                  : await session.jobs.start({ kind: input.kind })
              break
            case 'preview-open': {
              result = await withPreviewOperation(async () => {
                await session.jobs.refresh()
                const job = session.jobs.get(input.jobId)
                // Recheck source freshness at the actual window-open boundary.
                if (input.requireCurrent && (job.stale || job.state !== 'succeeded')) return { opened: false }
                for (const [key, window] of authorPreviewWindows)
                  if (key !== `${input.id}:${input.jobId}`) window.destroy()
                await openAuthorPreview(input.id, job)
                return { opened: true }
              })
              break
            }
            case 'cancel':
              result = await session.call('cancel', { jobId: input.jobId })
              authorPreviewWindows.get(`${input.id}:${input.jobId}`)?.close()
              break
            case 'media':
              result = await session.workspace.asset(input.file)
              break
            case 'show':
              shell.showItemInFolder(
                input.file
                  ? await session.workspace.path(input.file)
                  : path.join(session.workspace.root, 'package.json'),
              )
              break
            case 'editor':
              result = await manager.openExternal(
                input.id,
                input.file,
                input.editor,
                input.line ?? 1,
                input.column ?? 1,
              )
              break
            case 'sdk':
              await session.workspace.assertWritable()
              result = await (await manager.api()).connectDevelopmentSdk(session.workspace.root)
              break
            case 'connection':
              result = (await manager.api()).authorConnection(
                session.workspace.root,
                input.execute === true,
                manager.env,
                session.workspace.readOnly,
                manager.contextFile(input.id),
                session.workspace.published,
              )
              break
            default:
              throw new Error('不支持的作者操作')
          }
        }
      }
      return { result: result ?? null }
    } catch (error) {
      return { error: { code: error.code ?? 'AUTHOR_FAILED', message: error.message, file: error.file } }
    }
  })
  handle('desktop:list-content-packages', event => {
    requireLocalBattleCaller(event)
    return getContentLibrary().list()
  })
  handle('desktop:prepare-local-content', event => {
    requireLocalBattleCaller(event)
    return getLocalContentSessions().prepare(localContentOwner.current(), { displayOnly: true })
  })
  handle('desktop:read-local-runtime', (_event, token) => {
    return getLocalContentSessions().readRuntime(token, localContentOwner.current())
  })
  handle('desktop:capture-personal-environment', event => {
    requireLocalBattleCaller(event)
    return getLocalContentSessions().capturePersonalEnvironment(localContentOwner.current())
  })
  handle('desktop:release-local-content', (event, token) => {
    requireLocalBattleCaller(event)
    if (typeof token !== 'string') throw new Error('本地内容会话无效')
    return getLocalContentSessions().release(token)
  })
  handle('desktop:select-content-package-file', async (event, options) => {
    requireLocalBattleCaller(event)
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: '添加内容包',
      properties: ['openFile'],
      filters: [{ name: 'npm 内容包', extensions: ['tgz'] }],
    })
    requireLocalBattleCaller(event)
    if (selected.canceled || !selected.filePaths[0]) return null
    return getContentLibrary().stageFile(selected.filePaths[0], options?.offline === true)
  })
  handle('desktop:inspect-npm-content-package', (event, options) => {
    requireLocalBattleCaller(event)
    return getContentLibrary().stageNpm(options?.spec, options?.offline === true)
  })
  handle('desktop:install-content-package-file', async (event, options) => {
    requireLocalBattleCaller(event)
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: '安装并启用内容包',
      properties: ['openFile'],
      filters: [{ name: 'npm 内容包', extensions: ['tgz'] }],
    })
    requireLocalBattleCaller(event)
    if (selected.canceled || !selected.filePaths[0]) return null
    return getContentLibrary().installFile(selected.filePaths[0], options?.offline === true)
  })
  handle('desktop:install-npm-content-package', (event, options) => {
    requireLocalBattleCaller(event)
    return getContentLibrary().installNpm(options?.spec, options?.offline === true)
  })
  handle('desktop:content-package-action', async (event, input) => {
    requireLocalBattleCaller(event)
    if (!input || typeof input.action !== 'string') throw new Error('内容包操作无效')
    const library = getContentLibrary()
    if (input.action === 'import-sources') {
      const selected = await dialog.showOpenDialog(mainWindow, {
        title: '导入环境来源登记',
        properties: ['openFile'],
        filters: [{ name: '来源登记', extensions: ['json'] }],
      })
      requireLocalBattleCaller(event)
      if (selected.canceled || !selected.filePaths[0]) return null
      const result = await library.importSourceRegistry(selected.filePaths[0])
      return result.sourceIds.join('、')
    }
    if (input.action === 'cancel-install') {
      library.cancelInstall(input.operationId)
      return null
    }
    if (input.action === 'retry-install') return library.retryInstall(input.operationId)
    if (input.action === 'clear-install-tasks') {
      library.clearInstallTasks()
      return null
    }
    if (input.action === 'set-selection') {
      await library.setSelection(input.ids, input.offline === true)
      return null
    }
    if (input.action === 'confirm-install') return library.confirmInstall(input.planId, input.allowCode === true)
    if (input.action === 'plan-selection') return library.planSelection(input.ids, input.offline === true)
    if (input.action === 'apply-selection') {
      await library.applySelection(input.planId, input.allowCode === true)
      return null
    }
    if (input.action === 'cancel') {
      await library.cancel(input.planId)
      return null
    }
    if (input.action === 'uninstall') {
      await library.uninstall(input.packageId)
      return null
    }
    throw new Error('不支持的内容包操作')
  })
  handle('desktop:get-local-battle-status', event => {
    requireLocalBattleCaller(event)
    return localBattleHost.status()
  })

  handle('desktop:list-content-projects', event => {
    requireLocalBattleCaller(event)
    return getContentProjects().list()
  })
  handle('desktop:add-content-project', async event => {
    requireLocalBattleCaller(event)
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: '登记 npm 内容环境',
      properties: ['openDirectory'],
    })
    requireLocalBattleCaller(event)
    if (selected.canceled || !selected.filePaths[0]) return null
    return getContentProjects().add(selected.filePaths[0])
  })
  handle('desktop:content-project-action', async (event, input) => {
    requireLocalBattleCaller(event)
    if (!input || typeof input.id !== 'string') throw new Error('环境标识无效')
    const manager = getContentProjects()
    if (input.action === 'rename') return manager.rename(input.id, input.name)
    if (input.action === 'forget') return manager.forget(input.id)
    if (input.action === 'export') {
      const selected = await dialog.showSaveDialog(mainWindow, { title: '导出到新的环境目录', buttonLabel: '导出环境' })
      requireLocalBattleCaller(event)
      if (selected.canceled || !selected.filePath) return null
      await manager.export(input.id, selected.filePath, input.includeLocalArtifacts === true)
      return true
    }
    return manager.operate(input.id, input.action, { offline: input.offline === true })
  })

  handle('desktop:get-local-server-port', () => localServerPort)

  handle('desktop:download-pet-swf', async (_event, payload) => {
    const petNum = payload?.petNum
    const remoteUrl = payload?.remoteUrl || `${PET_REMOTE_BASE}/${petNum}.swf`
    const filePath = await downloadPetSwf(petNum, remoteUrl)
    return filePath
  })

  handle('desktop:list-cached-pets', async () => listCachedPets())
  handle('desktop:clear-pet-cache', async () => clearPetCache())

  handle('desktop:get-app-version', () => app.getVersion())
  handle('desktop:check-for-updates', async () => checkForUpdates())
  handle('desktop:download-and-install-update', async () => downloadAndInstallUpdate())

  handle('desktop:show-item-in-folder', async (_event, input) => {
    const dirPath = typeof input?.path === 'string' ? input.path : ''
    if (!dirPath) throw new Error('path required')
    shell.showItemInFolder(dirPath)
  })

  handle('desktop:relaunch', async () => {
    await localBattleHost.stop()
    await stopLocalServer()
    app.relaunch()
    app.exit(0)
  })
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      navigateOnDragDrop: false,
    },
  })

  protectDesktopNavigation(mainWindow, rendererUrl)
  localContentOwner = bindLocalContentOwner(mainWindow.webContents, owner => localContentSessions?.releaseOwner(owner))
  setupContextMenu(mainWindow)

  mainWindow.webContents.on('preload-error', (_event, preloadPathOnError, error) => {
    console.error(`Electron preload failed (${preloadPathOnError}):`, error)
  })

  mainWindow.webContents.on('did-finish-load', () => {
    void mainWindow?.webContents
      .executeJavaScript('typeof window.arcadiaDesktop !== "undefined"')
      .then(hasDesktopBridge => {
        console.log(`Electron desktop bridge status: ${hasDesktopBridge ? 'ready' : 'missing'}`)
      })
      .catch(error => {
        console.warn('Electron desktop bridge probe failed:', error)
      })
  })

  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl)
  } else {
    void mainWindow.loadURL(CLIENT_URL)
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

let stoppingForQuit
let stoppedForQuit = false
app.on('before-quit', event => {
  if (stoppedForQuit) return
  event.preventDefault()
  stoppingForQuit ??= (async () => {
    if (!(await remotePlay.prepareQuit())) {
      stoppingForQuit = undefined
      return
    }
    await stopForQuit(
      [
        () => swfHost.dispose(),
        () => remotePlay.destroy(),
        async () => {
          if (personalProfile) await (await personalProfile).storage.close()
        },
        () => localEnvironments?.close(),
        () => localContentSessions?.close(),
        () => localServerController.close(),
        () => localBattleHost.stop(),
        () => managementWorkspaceOwner?.close(),
        () => contentLibrary?.close(),
        () => contentProjects?.close(),
        () => authorWorkspaces?.close(),
        () => {
          for (const window of authorPreviewWindows.values()) window.destroy()
        },
        () => stopLocalServer(),
      ],
      {
        forceStop: () => localBattleHost.forceStop(),
      },
    )
    stoppedForQuit = true
    app.quit()
  })()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow()
    void getContentLibrary()
      .resume()
      .catch(() => {})
  }
})

app
  .whenReady()
  .then(async () => {
    if (!devServerUrl) registerClientProtocol(session.defaultSession, rendererDistDir)
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true

    await ensureAppDataDirs()
    await getManagementWorkspaceOwner().ready()
    await startLocalServer()
    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = { ...details.requestHeaders }
      // Inject only for the actual manager WebContents; never for remote renderers or unrelated windows.
      if (
        details.webContentsId === mainWindow?.webContents.id &&
        details.frame === mainWindow?.webContents.mainFrame &&
        new URL(details.url).origin === `http://127.0.0.1:${localServerPort}`
      ) {
        headers['x-arcadia-management'] = managementHttpToken
      }
      callback({ requestHeaders: headers })
    })
    setupIpcHandlers()
    swfHost.registerIpc(ipcMain)
    createMainWindow()
    void getContentLibrary()
      .resume()
      .catch(() => {})
  })
  .catch(error => {
    console.error('Electron startup failed:', error)
    app.quit()
  })
