import { app, BrowserWindow, ipcMain } from 'electron'
import { createRequire } from 'node:module'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promises as fs } from 'node:fs'

const require = createRequire(import.meta.url)
const { autoUpdater } = require('electron-updater')

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const rendererDistDir = path.join(projectRoot, 'dist')
const preloadPath = path.join(__dirname, 'preload.cjs')
const devServerUrl = process.env.ARCADIA_ELECTRON_DEV_SERVER_URL

const PET_REMOTE_BASE = 'https://seer2-pet-resource.yuuinih.com/public/fight'

let mainWindow = null
let localServer = null
let localServerPort = null
let petsDir = null
let packsDir = null

function isProtocolUrl(value) {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)
}

function normalizePathJoin(base, child) {
  const baseClean = String(base ?? '').replace(/^\/+|\/+$/g, '')
  const childClean = String(child ?? '').replace(/^\/+|\/+$/g, '')

  if (!baseClean) return childClean
  if (!childClean) return baseClean
  return `${baseClean}/${childClean}`
}

function toWorkspaceFileUrl(port, folder, relativePath) {
  const cleaned = String(relativePath).replace(/^\/+/, '')
  return `http://127.0.0.1:${port}/packs/${folder}/${cleaned}`
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

function sanitizeFolderName(input) {
  const trimmed = String(input ?? '').trim()
  if (!trimmed || trimmed === '.' || trimmed === '..') return null

  const normalized = trimmed.toLowerCase()
  if ([...normalized].every(c => /[A-Za-z0-9_-]/.test(c))) {
    return normalized
  }
  return null
}

function isValidPackId(input) {
  const trimmed = String(input ?? '').trim()
  if (!trimmed) return false
  return trimmed.split('.').every(segment => segment.length > 0 && /^[A-Za-z0-9_-]+$/.test(segment))
}

function isValidSemverLike(input) {
  const trimmed = String(input ?? '').trim()
  if (!trimmed) return false
  const parts = trimmed.split('.')
  return parts.length === 3 && parts.every(part => /^\d+$/.test(part))
}

function hasTraversalSegment(value) {
  const normalized = String(value ?? '')
    .replace(/\\/g, '/')
    .split('/')
  return normalized.some(segment => segment === '..')
}

function toStringArray(value) {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string') : []
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
    'Cache-Control': 'public, max-age=31536000, immutable',
  })
}

async function ensureAppDataDirs() {
  const userDataDir = app.getPath('userData')
  petsDir = path.join(userDataDir, 'pets')
  packsDir = path.join(userDataDir, 'packs')

  await Promise.all([fs.mkdir(petsDir, { recursive: true }), fs.mkdir(packsDir, { recursive: true })])
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
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error('petNum 非法')
  }

  const filePath = path.join(petsDir, `${number}.swf`)
  if (await pathExists(filePath)) {
    return filePath
  }

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

async function listAssetsRefs(packRoot, assetsRef) {
  if (isProtocolUrl(assetsRef)) {
    return [assetsRef]
  }

  const candidate = path.join(packRoot, assetsRef)
  try {
    const metadata = await fs.stat(candidate)
    if (metadata.isDirectory()) {
      const entries = await fs.readdir(candidate, { withFileTypes: true })
      const jsonFiles = entries
        .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
        .map(entry => path.join(assetsRef, entry.name).replace(/\\/g, '/'))

      if (jsonFiles.length === 0) {
        return [normalizePathJoin(assetsRef, 'assets.json')]
      }

      jsonFiles.sort((a, b) => {
        const aDefault = a.toLowerCase().endsWith('/assets.json') || a.toLowerCase() === 'assets.json'
        const bDefault = b.toLowerCase().endsWith('/assets.json') || b.toLowerCase() === 'assets.json'

        if (aDefault && !bDefault) return -1
        if (!aDefault && bDefault) return 1
        return a.localeCompare(b)
      })

      return jsonFiles
    }
  } catch {
    // ignore and fallback
  }

  if (assetsRef.toLowerCase().endsWith('.json')) {
    return [assetsRef]
  }
  return [normalizePathJoin(assetsRef, 'assets.json')]
}

async function discoverWorkspacePacks() {
  if (!packsDir) return []

  const discovered = []
  const entries = await fs.readdir(packsDir, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const folderName = entry.name
    const manifestPath = path.join(packsDir, folderName, 'pack.json')

    if (!(await pathExists(manifestPath))) continue

    let rawManifest
    try {
      rawManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    } catch {
      continue
    }

    if (!rawManifest || typeof rawManifest.id !== 'string') continue

    discovered.push({
      folderName,
      manifest: {
        id: rawManifest.id,
        version: typeof rawManifest.version === 'string' && rawManifest.version ? rawManifest.version : '1.0.0',
        paths: rawManifest.paths && typeof rawManifest.paths === 'object' ? rawManifest.paths : {},
        data: {
          effects: toStringArray(rawManifest.data?.effects),
          marks: toStringArray(rawManifest.data?.marks),
          skills: toStringArray(rawManifest.data?.skills),
          species: toStringArray(rawManifest.data?.species),
        },
        assetsRef: rawManifest.assetsRef,
      },
    })
  }

  discovered.sort((a, b) => {
    const aIsBase = a.manifest.id === 'arcadia-eternity.base'
    const bIsBase = b.manifest.id === 'arcadia-eternity.base'

    if (aIsBase && !bIsBase) return -1
    if (!aIsBase && bIsBase) return 1
    return a.manifest.id.localeCompare(b.manifest.id)
  })

  return discovered
}

async function buildWorkspaceManifest(port) {
  const discovered = await discoverWorkspacePacks()
  if (discovered.length === 0) return null
  if (!discovered.some(item => item.manifest.id === 'arcadia-eternity.base')) return null

  const effects = []
  const marks = []
  const skills = []
  const species = []
  const assetsRef = []

  for (const pack of discovered) {
    const dataDir =
      pack.manifest.paths && typeof pack.manifest.paths.dataDir === 'string' && pack.manifest.paths.dataDir
        ? pack.manifest.paths.dataDir
        : '.'

    for (const file of pack.manifest.data.effects) {
      effects.push(toWorkspaceFileUrl(port, pack.folderName, normalizePathJoin(dataDir, file)))
    }
    for (const file of pack.manifest.data.marks) {
      marks.push(toWorkspaceFileUrl(port, pack.folderName, normalizePathJoin(dataDir, file)))
    }
    for (const file of pack.manifest.data.skills) {
      skills.push(toWorkspaceFileUrl(port, pack.folderName, normalizePathJoin(dataDir, file)))
    }
    for (const file of pack.manifest.data.species) {
      species.push(toWorkspaceFileUrl(port, pack.folderName, normalizePathJoin(dataDir, file)))
    }

    const rawRefs = Array.isArray(pack.manifest.assetsRef)
      ? pack.manifest.assetsRef.filter(value => typeof value === 'string')
      : typeof pack.manifest.assetsRef === 'string'
        ? [pack.manifest.assetsRef]
        : []

    const packRoot = path.join(packsDir, pack.folderName)
    for (const rawRef of rawRefs) {
      const resolvedRefs = await listAssetsRefs(packRoot, rawRef)
      for (const refEntry of resolvedRefs) {
        if (isProtocolUrl(refEntry)) {
          assetsRef.push(refEntry)
        } else {
          assetsRef.push(toWorkspaceFileUrl(port, pack.folderName, refEntry))
        }
      }
    }
  }

  return {
    id: 'arcadia-eternity.workspace',
    version: '1.0.0',
    engine: 'seer2-v2',
    layoutVersion: 1,
    paths: {
      dataDir: '.',
      localesDir: '.',
    },
    data: {
      effects,
      marks,
      skills,
      species,
    },
    ...(assetsRef.length > 0 ? { assetsRef } : {}),
  }
}

async function buildWorkspaceIndex() {
  const discovered = await discoverWorkspacePacks()
  return discovered.map(item => ({
    folderName: item.folderName,
    id: item.manifest.id,
    version: item.manifest.version,
    manifestPath: `${item.folderName}/pack.json`,
  }))
}

function listPackTemplates() {
  return [
    {
      id: 'starter',
      name: 'Starter Pack',
      description: '基础可运行模板，包含最小的 effect/mark/skill/species 与 locales 结构',
    },
  ]
}

function starterTemplateFiles(packId, version) {
  const packJson = JSON.stringify(
    {
      id: packId,
      version,
      engine: 'seer2-v2',
      layoutVersion: 1,
      assetsRef: 'assets',
      paths: {
        dataDir: 'data',
        localesDir: 'locales',
      },
      data: {
        effects: ['effect.yaml'],
        marks: ['mark.yaml'],
        skills: ['skill.yaml'],
        species: ['species.yaml'],
      },
      locales: {
        'zh-CN': ['mark', 'skill', 'species', 'webui', 'battle'],
      },
    },
    null,
    2,
  )

  const assetsJson = JSON.stringify(
    {
      id: `${packId}.assets`,
      version,
      engine: 'seer2-v2',
      assets: [],
      mappings: {
        species: {},
        marks: {},
        skills: {},
      },
    },
    null,
    2,
  )

  return [
    ['pack.json', packJson],
    ['assets/assets.json', assetsJson],
    [
      'data/effect.yaml',
      '- id: effect_template_power_up\n  trigger: OnDamage\n  priority: 0\n  apply:\n    type: addPower\n    target: useSkillContext\n    value: 10\n',
    ],
    ['data/mark.yaml', '- id: mark_template\n  effect:\n    - effect_template_power_up\n'],
    [
      'data/skill.yaml',
      '- id: skill_template\n  element: Normal\n  category: Physical\n  target: opponent\n  power: 60\n  rage: 0\n  accuracy: 100\n  effect:\n    - effect_template_power_up\n',
    ],
    [
      'data/species.yaml',
      '- id: pet_template\n  num: 900001\n  element: Normal\n  baseStats:\n    hp: 100\n    atk: 100\n    def: 100\n    spa: 100\n    spd: 100\n    spe: 100\n  genderRatio: [50, 50]\n  heightRange: [10, 20]\n  weightRange: [10, 20]\n  ability: []\n  emblem: []\n  learnable_skills:\n    - level: 1\n      skill_id: skill_template\n      hidden: false\n',
    ],
    ['locales/zh-CN/mark.yaml', 'mark_template:\n  name: 模板印记\n'],
    ['locales/zh-CN/skill.yaml', 'skill_template:\n  name: 模板技能\n'],
    ['locales/zh-CN/species.yaml', 'pet_template:\n  name: 模板精灵\n'],
    ['locales/zh-CN/webui.yaml', 'pack_template:\n  name: 模板数据包\n'],
    ['locales/zh-CN/battle.yaml', 'template_message: 模板数据包已加载\n'],
    ['README.md', '# Starter Pack\n\n此目录由内置模板生成，可直接在编辑器中按数据包维度进行修改。\n'],
  ]
}

async function createPackFromTemplate(input) {
  const templateId = typeof input?.template === 'string' && input.template ? input.template : 'starter'
  if (templateId !== 'starter') {
    throw new Error(`不支持的模板: ${templateId}`)
  }

  const folderName = sanitizeFolderName(input?.folderName)
  if (!folderName) {
    throw new Error('folderName 仅允许字母、数字、-、_，且不能为空')
  }

  const packId =
    typeof input?.packId === 'string' && input.packId.trim()
      ? input.packId.trim()
      : `user.${folderName.replace(/-/g, '_')}`
  if (!isValidPackId(packId)) {
    throw new Error('packId 格式非法，建议使用 a.b.c 形式，且每段仅允许字母/数字/-/_')
  }

  const version =
    typeof input?.version === 'string' && input.version.trim() ? input.version.trim() : '0.1.0'
  if (!isValidSemverLike(version)) {
    throw new Error('version 必须是 x.y.z 数字格式')
  }

  if (!packsDir) {
    throw new Error('packs 目录不可用')
  }

  await fs.mkdir(packsDir, { recursive: true })

  const targetDir = path.join(packsDir, folderName)
  if (await pathExists(targetDir)) {
    throw new Error(`数据包目录已存在: ${folderName}`)
  }

  await fs.mkdir(targetDir, { recursive: true })

  const files = starterTemplateFiles(packId, version)
  const createdFiles = []

  for (const [relativePath, content] of files) {
    const destination = path.join(targetDir, relativePath)
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.writeFile(destination, content, 'utf8')
    createdFiles.push(relativePath)
  }

  return {
    folderName,
    packId,
    version,
    packPath: targetDir,
    createdFiles,
  }
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
    // eslint-disable-next-line no-await-in-loop
    const available = await isPortAvailable(port)
    if (available) {
      return port
    }
  }
  return null
}

function resolvePackFilePath(tailPath) {
  if (!packsDir) return null
  const rawPath = String(tailPath ?? '').replace(/^\/+/, '')
  if (!rawPath || hasTraversalSegment(rawPath)) {
    return null
  }

  const normalized = path.normalize(rawPath)
  const candidate = path.join(packsDir, normalized)
  const relative = path.relative(packsDir, candidate)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null
  }

  return candidate
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

  if (pathname === '/packs/workspace/pack.json') {
    if (!localServerPort) {
      sendJson(res, 404, { error: 'workspace pack not ready' })
      return
    }

    const manifest = await buildWorkspaceManifest(localServerPort)
    if (!manifest) {
      sendJson(res, 404, { error: 'workspace pack not ready' })
      return
    }

    sendJson(res, 200, manifest)
    return
  }

  if (pathname === '/packs/workspace/index.json') {
    const summary = await buildWorkspaceIndex()
    sendJson(res, 200, summary)
    return
  }

  if (pathname.startsWith('/packs/')) {
    const tail = pathname.slice('/packs/'.length)
    const filePath = resolvePackFilePath(tail)
    if (!filePath || !(await pathExists(filePath))) {
      sendJson(res, 404, { error: 'not found' })
      return
    }

    try {
      const stat = await fs.stat(filePath)
      if (!stat.isFile()) {
        sendJson(res, 404, { error: 'not found' })
        return
      }
      await sendFile(res, filePath)
      return
    } catch {
      sendJson(res, 404, { error: 'not found' })
      return
    }
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
  ipcMain.handle('desktop:get-local-server-port', () => localServerPort)

  ipcMain.handle('desktop:download-pet-swf', async (_event, payload) => {
    const petNum = payload?.petNum
    const remoteUrl = payload?.remoteUrl || `${PET_REMOTE_BASE}/${petNum}.swf`
    const filePath = await downloadPetSwf(petNum, remoteUrl)
    return filePath
  })

  ipcMain.handle('desktop:list-cached-pets', async () => listCachedPets())
  ipcMain.handle('desktop:clear-pet-cache', async () => clearPetCache())

  ipcMain.handle('desktop:list-pack-templates', () => listPackTemplates())
  ipcMain.handle('desktop:list-workspace-packs', async () => buildWorkspaceIndex())
  ipcMain.handle('desktop:create-pack-from-template', async (_event, input) => createPackFromTemplate(input))

  ipcMain.handle('desktop:get-app-version', () => app.getVersion())
  ipcMain.handle('desktop:check-for-updates', async () => checkForUpdates())
  ipcMain.handle('desktop:download-and-install-update', async () => downloadAndInstallUpdate())

  ipcMain.handle('desktop:relaunch', () => {
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
    },
  })

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
    void mainWindow.loadFile(path.join(rendererDistDir, 'index.html'))
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  void stopLocalServer()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow()
  }
})

app.whenReady()
  .then(async () => {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true

    await ensureAppDataDirs()
    await startLocalServer()
    setupIpcHandlers()
    createMainWindow()
  })
  .catch(error => {
    console.error('Electron startup failed:', error)
    app.quit()
  })
