import { app, BrowserWindow, Menu, shell, ipcMain, dialog, session } from 'electron'
import { createRequire } from 'node:module'
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promises as fs } from 'node:fs'
import { LocalBattleHost } from './local-battle-host.mjs'
import { isTrustedDesktopRequest } from './local-battle-ipc.mjs'
import { createRemotePlayController, protectDesktopNavigation } from './remote-play.mjs'
import { createSwfHost } from './swf-host.mjs'
import { CLIENT_URL, CLIENT_ORIGIN, registerClientProtocol } from './client-protocol.mjs'
import { stopForQuit } from './shutdown.mjs'
import { ContentProjectManager, runContentCommand } from './content-projects.mjs'
import { ContentLibrary } from './content-library.mjs'
import { AuthorWorkspaces } from './author-workspaces.mjs'

const require = createRequire(import.meta.url)
const { autoUpdater } = require('electron-updater')
const { parse: parseYaml } = require('yaml')

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const rendererDistDir = path.join(projectRoot, 'dist')
const preloadPath = path.join(__dirname, 'preload.cjs')
const devServerUrl = process.env.ARCADIA_ELECTRON_DEV_SERVER_URL
const rendererUrl = devServerUrl ?? CLIENT_URL
const localBattleHost = new LocalBattleHost({
  executable: process.execPath,
  cli: app.isPackaged
    ? path.join(process.resourcesPath, 'arcadia-server', 'cli.js')
    : path.resolve(projectRoot, '../../dist/cli.js'),
  rendererOrigin: devServerUrl ? new URL(devServerUrl).origin : CLIENT_ORIGIN,
  ...(app.isPackaged
    ? {
        npmCliPath: path.join(process.resourcesPath, 'arcadia-server', 'runtime', 'npm', 'bin', 'npm-cli.js'),
        packsDirectory: path.join(process.resourcesPath, 'arcadia-server', 'packs'),
      }
    : {}),
})

const PET_REMOTE_BASE = 'https://seer2-pet-resource.yuuinih.com/public/fight'
const BASE_PACK_ID = 'arcadia-eternity.base'
const BASE_PACK_FOLDER = 'base'

const remotePlay = createRemotePlayController({
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
let packsDir = null
let workspacePackStatePath = null
let creatorWorkStorage
let contentProjects
let contentLibrary
let authorWorkspaces
function getAuthorWorkspaces() {
  authorWorkspaces ??= new AuthorWorkspaces({
    root: path.join(app.getPath('userData'), 'ugc'),
    api: () =>
      import(
        app.isPackaged
          ? pathToFileURL(
              path.join(
                process.resourcesPath,
                'arcadia-server/node_modules/@arcadia-eternity/content-dev/dist/author-api.mjs',
              ),
            ).href
          : '@arcadia-eternity/content-dev/workspace'
      ),
    notify: event => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('desktop:author-changed', event)
    },
    env: {
      ...process.env,
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
function getContentProjects() {
  contentProjects ??= new ContentProjectManager({
    file: path.join(app.getPath('userData'), 'content-projects.json'),
    host: localBattleHost,
    run: (args, signal) => runContentCommand(localBattleHost, args, signal),
  })
  return contentProjects
}
async function getCreatorWorkStorage() {
  const loader = app.isPackaged
    ? pathToFileURL(
        path.join(
          process.resourcesPath,
          'arcadia-server',
          'node_modules',
          '@arcadia-eternity',
          'pack-loader',
          'dist',
          'node.js',
        ),
      ).href
    : '@arcadia-eternity/pack-loader/node'
  creatorWorkStorage ??= import(loader).then(
    ({ NodeWorkStorage }) => new NodeWorkStorage(path.join(app.getPath('userData'), 'creator-works')),
  )
  return creatorWorkStorage
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

function sanitizeExistingFolderName(input) {
  const trimmed = String(input ?? '').trim()
  if (!trimmed || trimmed === '.' || trimmed === '..') return null
  if (trimmed.includes('/') || trimmed.includes('\\') || hasTraversalSegment(trimmed)) return null
  return trimmed
}

function sanitizeWorkspaceRelativePath(input) {
  const trimmed = String(input ?? '').trim()
  if (!trimmed) return null
  if (trimmed.startsWith('/') || trimmed.startsWith('\\')) return null
  if (isProtocolUrl(trimmed) || hasTraversalSegment(trimmed)) return null

  const normalized = path.normalize(trimmed).replace(/\\/g, '/')
  if (!normalized || normalized === '..' || normalized.startsWith('../')) return null
  return normalized
}

function resolveWorkspacePackDir(folderNameInput) {
  if (!packsDir) {
    throw new Error('packs 目录不可用')
  }

  const folderName = sanitizeExistingFolderName(folderNameInput)
  if (!folderName) {
    throw new Error('folderName 非法')
  }

  const packDir = path.join(packsDir, folderName)
  const relative = path.relative(packsDir, packDir)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('folderName 非法')
  }

  return { folderName, packDir }
}

function resolveWorkspacePackFile(folderNameInput, relativePathInput) {
  const { folderName, packDir } = resolveWorkspacePackDir(folderNameInput)
  const relativePath = sanitizeWorkspaceRelativePath(relativePathInput)
  if (!relativePath) {
    throw new Error('relativePath 非法')
  }

  const filePath = path.join(packDir, relativePath)
  const relative = path.relative(packDir, filePath)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('relativePath 非法')
  }

  return { folderName, packDir, relativePath, filePath }
}

function resolveWorkspacePackPath(folderNameInput, relativePathInput) {
  const { folderName, packDir } = resolveWorkspacePackDir(folderNameInput)
  const relativePath = sanitizeWorkspaceRelativePath(relativePathInput)
  if (!relativePath) {
    throw new Error('relativePath 非法')
  }

  const absolutePath = path.join(packDir, relativePath)
  const relative = path.relative(packDir, absolutePath)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('relativePath 非法')
  }

  return { folderName, packDir, relativePath, absolutePath }
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

function toPackDependencyArray(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter(dep => dep && typeof dep === 'object' && typeof dep.path === 'string' && dep.path.trim().length > 0)
    .map(dep => ({
      path: dep.path,
      id: typeof dep.id === 'string' && dep.id.trim().length > 0 ? dep.id.trim() : undefined,
      optional: Boolean(dep.optional),
    }))
}

function compareWorkspacePack(a, b) {
  const aIsBase = a.manifest.id === BASE_PACK_ID
  const bIsBase = b.manifest.id === BASE_PACK_ID
  if (aIsBase && !bIsBase) return -1
  if (!aIsBase && bIsBase) return 1
  const idCompare = a.manifest.id.localeCompare(b.manifest.id)
  if (idCompare !== 0) return idCompare
  return a.folderName.localeCompare(b.folderName)
}

function resolveDependencyFolderByPath(sourcePack, dependencyPath, byFolder) {
  if (!packsDir) return null
  if (isProtocolUrl(dependencyPath)) return null

  const sourceRoot = path.join(packsDir, sourcePack.folderName)
  let dependencyManifestPath = path.resolve(sourceRoot, dependencyPath)
  if (path.extname(dependencyManifestPath).toLowerCase() !== '.json') {
    dependencyManifestPath = path.join(dependencyManifestPath, 'pack.json')
  }

  const relative = path.relative(packsDir, dependencyManifestPath)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null

  const segments = relative.split(path.sep).filter(Boolean)
  const folderName = segments[0]
  if (!folderName || !byFolder.has(folderName)) return null
  return folderName
}

function buildWorkspaceDependencyInfo(discovered) {
  const byFolder = new Map(discovered.map(pack => [pack.folderName, pack]))
  const byId = new Map()
  for (const pack of discovered) {
    const existing = byId.get(pack.manifest.id) ?? []
    existing.push(pack)
    byId.set(pack.manifest.id, existing)
  }

  const requiredDepsByFolder = new Map()
  const unresolvedRequiredByFolder = new Map()
  const requiredByFolder = new Map(discovered.map(pack => [pack.folderName, []]))

  for (const pack of discovered) {
    const resolvedDeps = []
    const unresolved = []
    for (const dep of pack.manifest.dependencies ?? []) {
      let resolvedFolder = resolveDependencyFolderByPath(pack, dep.path, byFolder)

      if (!resolvedFolder && dep.id) {
        const idCandidates = byId.get(dep.id) ?? []
        if (idCandidates.length === 1) {
          resolvedFolder = idCandidates[0].folderName
        } else if (idCandidates.length > 1 && !dep.optional) {
          unresolved.push(`依赖 id '${dep.id}' 在工作区不唯一，请改用路径依赖`)
          continue
        }
      }

      if (resolvedFolder) {
        const targetPack = byFolder.get(resolvedFolder)
        if (dep.id && targetPack?.manifest.id !== dep.id) {
          if (!dep.optional) {
            unresolved.push(
              `依赖 '${dep.path}' 的 id 不匹配，期望 '${dep.id}'，实际 '${targetPack?.manifest.id ?? 'unknown'}'`,
            )
          }
          continue
        }
        resolvedDeps.push(resolvedFolder)
        continue
      }

      if (!dep.optional) {
        unresolved.push(`依赖 '${dep.id ?? dep.path}' 未找到`)
      }
    }

    const dedupDeps = [...new Set(resolvedDeps)]
    requiredDepsByFolder.set(pack.folderName, dedupDeps)
    if (unresolved.length > 0) {
      unresolvedRequiredByFolder.set(pack.folderName, unresolved)
    }
  }

  for (const [folderName, deps] of requiredDepsByFolder.entries()) {
    for (const depFolder of deps) {
      const dependents = requiredByFolder.get(depFolder)
      if (!dependents) continue
      dependents.push(folderName)
    }
  }

  for (const [folderName, dependents] of requiredByFolder.entries()) {
    dependents.sort((a, b) => compareWorkspacePack(byFolder.get(a), byFolder.get(b)))
    requiredByFolder.set(folderName, [...new Set(dependents)])
  }

  return {
    byFolder,
    requiredDepsByFolder,
    unresolvedRequiredByFolder,
    requiredByFolder,
  }
}

function sortEnabledPacksByDependencies(discovered, enabledFolders, dependencyInfo) {
  const enabledPacks = discovered.filter(pack => enabledFolders.has(pack.folderName))
  if (enabledPacks.length === 0) return []

  const indegree = new Map()
  const outgoing = new Map()

  for (const pack of enabledPacks) {
    indegree.set(pack.folderName, 0)
    outgoing.set(pack.folderName, [])
  }

  for (const pack of enabledPacks) {
    const deps = dependencyInfo.requiredDepsByFolder.get(pack.folderName) ?? []
    for (const depFolder of deps) {
      if (!enabledFolders.has(depFolder)) continue
      indegree.set(pack.folderName, (indegree.get(pack.folderName) ?? 0) + 1)
      const dependents = outgoing.get(depFolder)
      if (dependents) dependents.push(pack.folderName)
    }
  }

  for (const [folderName, dependents] of outgoing.entries()) {
    dependents.sort((a, b) => compareWorkspacePack(dependencyInfo.byFolder.get(a), dependencyInfo.byFolder.get(b)))
    outgoing.set(folderName, dependents)
  }

  const queue = enabledPacks.filter(pack => (indegree.get(pack.folderName) ?? 0) === 0).sort(compareWorkspacePack)
  const ordered = []

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) continue
    ordered.push(current)

    const dependents = outgoing.get(current.folderName) ?? []
    for (const dependent of dependents) {
      const nextDegree = (indegree.get(dependent) ?? 0) - 1
      indegree.set(dependent, nextDegree)
      if (nextDegree === 0) {
        const pack = dependencyInfo.byFolder.get(dependent)
        if (pack) queue.push(pack)
      }
    }
    queue.sort(compareWorkspacePack)
  }

  if (ordered.length !== enabledPacks.length) {
    const cyclePacks = enabledPacks
      .filter(pack => !ordered.some(item => item.folderName === pack.folderName))
      .map(pack => pack.manifest.id)
      .join(', ')
    throw new Error(`检测到数据包依赖循环: ${cyclePacks}`)
  }

  return ordered
}

function resolveWorkspaceSelection(discovered, state, dependencyInfo) {
  const disabledFolders = new Set(
    Array.isArray(state?.disabledFolders) ? state.disabledFolders.filter(value => typeof value === 'string') : [],
  )

  const enabledFolders = new Set()
  for (const pack of discovered) {
    if (pack.manifest.id === BASE_PACK_ID || !disabledFolders.has(pack.folderName)) {
      enabledFolders.add(pack.folderName)
    }
  }

  let changed = true
  while (changed) {
    changed = false
    for (const folderName of [...enabledFolders]) {
      const deps = dependencyInfo.requiredDepsByFolder.get(folderName) ?? []
      for (const depFolder of deps) {
        if (!enabledFolders.has(depFolder)) {
          enabledFolders.add(depFolder)
          changed = true
        }
      }
    }
  }

  const dependencyIssues = []
  for (const folderName of enabledFolders) {
    const pack = dependencyInfo.byFolder.get(folderName)
    const unresolved = dependencyInfo.unresolvedRequiredByFolder.get(folderName) ?? []
    for (const issue of unresolved) {
      dependencyIssues.push(`${pack?.manifest.id ?? folderName}: ${issue}`)
    }
  }

  const orderedPacks = sortEnabledPacksByDependencies(discovered, enabledFolders, dependencyInfo)
  return {
    enabledFolders,
    orderedPacks,
    dependencyIssues,
  }
}

async function pathExists(target) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

async function readPackManifest(manifestPath) {
  try {
    const raw = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    if (!raw || typeof raw.id !== 'string') return null
    return raw
  } catch {
    return null
  }
}

async function findBundledBasePackDir() {
  const candidates = [path.resolve(projectRoot, '../../packs/base')]
  for (const candidate of candidates) {
    const manifest = await readPackManifest(path.join(candidate, 'pack.json'))
    if (manifest?.id === BASE_PACK_ID) {
      return candidate
    }
  }
  return null
}

async function hasWorkspaceBasePack() {
  if (!packsDir) return false
  const entries = await fs.readdir(packsDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const manifest = await readPackManifest(path.join(packsDir, entry.name, 'pack.json'))
    if (manifest?.id === BASE_PACK_ID) {
      return true
    }
  }
  return false
}

async function ensureWorkspaceBasePack() {
  if (devServerUrl) return
  if (!packsDir) return
  if (await hasWorkspaceBasePack()) return

  const bundledBaseDir = await findBundledBasePackDir()
  if (!bundledBaseDir) {
    console.warn('Workspace base pack source not found, skip seeding default pack')
    return
  }

  let targetDir = path.join(packsDir, BASE_PACK_FOLDER)
  if (await pathExists(targetDir)) {
    let index = 1
    while (await pathExists(path.join(packsDir, `${BASE_PACK_FOLDER}-${index}`))) {
      index += 1
    }
    targetDir = path.join(packsDir, `${BASE_PACK_FOLDER}-${index}`)
  }

  await fs.cp(bundledBaseDir, targetDir, {
    recursive: true,
    force: false,
    errorOnExist: false,
  })
  console.log(`Seeded default base pack into workspace: ${targetDir}`)
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
  packsDir = path.join(userDataDir, 'packs')
  workspacePackStatePath = path.join(userDataDir, 'packs-state.json')

  await Promise.all([fs.mkdir(petsDir, { recursive: true }), fs.mkdir(packsDir, { recursive: true })])
  await ensureWorkspaceBasePack()
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
      manifestPath,
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
        dependencies: toPackDependencyArray(rawManifest.dependencies),
      },
    })
  }

  discovered.sort(compareWorkspacePack)

  return discovered
}

async function readWorkspacePackState() {
  if (!workspacePackStatePath) {
    return { disabledFolders: [] }
  }

  try {
    const raw = JSON.parse(await fs.readFile(workspacePackStatePath, 'utf8'))
    const disabledFolders = Array.isArray(raw?.disabledFolders)
      ? raw.disabledFolders.filter(value => typeof value === 'string')
      : []
    return { disabledFolders }
  } catch {
    return { disabledFolders: [] }
  }
}

async function writeWorkspacePackState(state) {
  if (!workspacePackStatePath) return

  const normalized = {
    disabledFolders: [...new Set((state?.disabledFolders ?? []).filter(value => typeof value === 'string'))].sort(),
  }
  await fs.writeFile(workspacePackStatePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
}

function listEnabledDependents(folderName, enabledFolders, dependencyInfo) {
  const dependents = dependencyInfo.requiredByFolder.get(folderName) ?? []
  return dependents
    .filter(depFolder => enabledFolders.has(depFolder))
    .map(depFolder => dependencyInfo.byFolder.get(depFolder))
    .filter(Boolean)
}

async function setWorkspacePackEnabled(input) {
  const folderName = sanitizeExistingFolderName(input?.folderName)
  if (!folderName) {
    throw new Error('folderName 非法')
  }

  const enabled = Boolean(input?.enabled)
  const discovered = await discoverWorkspacePacks()
  const target =
    discovered.find(item => item.folderName === folderName) ??
    discovered.find(item => item.folderName.toLowerCase() === folderName.toLowerCase())
  if (!target) {
    throw new Error(`未找到工作区数据包目录: ${folderName}`)
  }
  const targetFolderName = target.folderName
  if (target.manifest.id === BASE_PACK_ID && !enabled) {
    throw new Error('默认数据包不可禁用')
  }

  const state = await readWorkspacePackState()
  const dependencyInfo = buildWorkspaceDependencyInfo(discovered)
  const nextDisabled = new Set(state.disabledFolders)

  if (enabled) {
    const stack = [targetFolderName]
    const visited = new Set()

    while (stack.length > 0) {
      const current = stack.pop()
      if (!current || visited.has(current)) continue
      visited.add(current)
      nextDisabled.delete(current)

      const unresolved = dependencyInfo.unresolvedRequiredByFolder.get(current) ?? []
      if (unresolved.length > 0) {
        const packId = dependencyInfo.byFolder.get(current)?.manifest.id ?? current
        throw new Error(`无法启用 '${packId}'，存在未满足依赖: ${unresolved.join('；')}`)
      }

      const deps = dependencyInfo.requiredDepsByFolder.get(current) ?? []
      for (const depFolder of deps) {
        nextDisabled.delete(depFolder)
        stack.push(depFolder)
      }
    }
  } else {
    const currentSelection = resolveWorkspaceSelection(discovered, state, dependencyInfo)
    const blockingDependents = listEnabledDependents(
      targetFolderName,
      currentSelection.enabledFolders,
      dependencyInfo,
    ).filter(pack => pack.folderName !== targetFolderName)

    if (blockingDependents.length > 0) {
      const names = blockingDependents.map(pack => pack.manifest.id).join(', ')
      throw new Error(`无法禁用，以下已启用数据包依赖它: ${names}`)
    }

    nextDisabled.add(targetFolderName)
  }

  const nextSelection = resolveWorkspaceSelection(discovered, { disabledFolders: [...nextDisabled] }, dependencyInfo)
  if (nextSelection.dependencyIssues.length > 0) {
    throw new Error(`启用状态存在依赖问题: ${nextSelection.dependencyIssues.join('；')}`)
  }

  await writeWorkspacePackState({ disabledFolders: [...nextDisabled] })
  return {
    folderName: targetFolderName,
    enabled: nextSelection.enabledFolders.has(targetFolderName) || target.manifest.id === BASE_PACK_ID,
  }
}

async function buildWorkspaceManifest(port) {
  const [discovered, state] = await Promise.all([discoverWorkspacePacks(), readWorkspacePackState()])

  // Dev mode: inject base pack from source directory
  if (devServerUrl && !discovered.some(p => p.manifest?.id === BASE_PACK_ID)) {
    const baseDir = await findBundledBasePackDir()
    if (baseDir) {
      const raw = await readPackManifest(path.join(baseDir, 'pack.json'))
      if (raw?.id === BASE_PACK_ID) {
        discovered.unshift({
          folderName: BASE_PACK_FOLDER,
          manifestPath: path.join(baseDir, 'pack.json'),
          manifest: {
            id: raw.id,
            version: typeof raw.version === 'string' && raw.version ? raw.version : '1.0.0',
            paths: raw.paths && typeof raw.paths === 'object' ? raw.paths : {},
            data: {
              effects: toStringArray(raw.data?.effects),
              marks: toStringArray(raw.data?.marks),
              skills: toStringArray(raw.data?.skills),
              species: toStringArray(raw.data?.species),
            },
            assetsRef: raw.assetsRef,
            dependencies: toPackDependencyArray(raw.dependencies),
          },
        })
      }
    }
  }

  if (discovered.length === 0) return null

  const dependencyInfo = buildWorkspaceDependencyInfo(discovered)
  const selection = resolveWorkspaceSelection(discovered, state, dependencyInfo)
  if (selection.dependencyIssues.length > 0) {
    console.warn('Workspace dependency issues detected:', selection.dependencyIssues)
    return null
  }

  const packs = selection.orderedPacks
  if (packs.length === 0) return null
  if (!packs.some(item => item.manifest.id === BASE_PACK_ID)) return null

  const effects = []
  const marks = []
  const skills = []
  const species = []
  const assetsRef = []

  for (const pack of packs) {
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
  const [discovered, state] = await Promise.all([discoverWorkspacePacks(), readWorkspacePackState()])
  const dependencyInfo = buildWorkspaceDependencyInfo(discovered)
  const selection = resolveWorkspaceSelection(discovered, state, dependencyInfo)
  const orderedEnabled = selection.orderedPacks
  const orderedDisabled = discovered
    .filter(pack => !selection.enabledFolders.has(pack.folderName))
    .sort(compareWorkspacePack)

  return [...orderedEnabled, ...orderedDisabled].map(item => {
    const enabled = selection.enabledFolders.has(item.folderName)
    const requiredByEnabled = listEnabledDependents(item.folderName, selection.enabledFolders, dependencyInfo)
    const isBase = item.manifest.id === BASE_PACK_ID
    return {
      folderName: item.folderName,
      id: item.manifest.id,
      version: item.manifest.version,
      manifestPath: `${item.folderName}/pack.json`,
      enabled,
      canDisable: !isBase && (!enabled || requiredByEnabled.length === 0),
    }
  })
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
      presentation: 'presentation.json',
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

  const presentationJson = JSON.stringify(
    { version: 2, defaultLocale: 'zh-CN', bindings: [], resources: [], locales: {} },
    null,
    2,
  )

  return [
    ['pack.json', packJson],
    ['presentation.json', presentationJson],
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

  const version = typeof input?.version === 'string' && input.version.trim() ? input.version.trim() : '0.1.0'
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

async function assertWorkspacePackDirExists(packDir, folderName) {
  let stat
  try {
    stat = await fs.stat(packDir)
  } catch {
    throw new Error(`未找到工作区数据包目录: ${folderName}`)
  }

  if (!stat.isDirectory()) {
    throw new Error(`工作区数据包目录不可用: ${folderName}`)
  }
}

async function readWorkspacePackManifest(input) {
  const { folderName, packDir } = resolveWorkspacePackDir(input?.folderName)
  await assertWorkspacePackDirExists(packDir, folderName)

  const manifestPath = path.join(packDir, 'pack.json')
  let raw
  try {
    raw = await fs.readFile(manifestPath, 'utf8')
  } catch {
    throw new Error(`未找到数据包清单: ${folderName}/pack.json`)
  }

  let manifest
  try {
    manifest = JSON.parse(raw)
  } catch {
    throw new Error(`数据包清单 JSON 无法解析: ${folderName}/pack.json`)
  }

  if (!manifest || typeof manifest !== 'object' || typeof manifest.id !== 'string') {
    throw new Error(`数据包清单格式非法: ${folderName}/pack.json`)
  }

  return {
    folderName,
    manifest,
  }
}

async function writeWorkspacePackManifest(input) {
  const { folderName, packDir } = resolveWorkspacePackDir(input?.folderName)
  await assertWorkspacePackDirExists(packDir, folderName)

  const manifest = input?.manifest
  if (!manifest || typeof manifest !== 'object' || typeof manifest.id !== 'string') {
    throw new Error('manifest 格式非法，必须至少包含 id')
  }

  const manifestPath = path.join(packDir, 'pack.json')
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

async function readWorkspacePackFile(input) {
  const { folderName, packDir, relativePath, filePath } = resolveWorkspacePackFile(
    input?.folderName,
    input?.relativePath,
  )
  await assertWorkspacePackDirExists(packDir, folderName)

  let stat
  try {
    stat = await fs.stat(filePath)
  } catch {
    throw new Error(`文件不存在: ${folderName}/${relativePath}`)
  }
  if (!stat.isFile()) {
    throw new Error(`目标不是文件: ${folderName}/${relativePath}`)
  }

  const content = await fs.readFile(filePath, 'utf8')
  return {
    folderName,
    relativePath,
    content,
  }
}

async function writeWorkspacePackFile(input) {
  const { folderName, packDir, relativePath, filePath } = resolveWorkspacePackFile(
    input?.folderName,
    input?.relativePath,
  )
  await assertWorkspacePackDirExists(packDir, folderName)

  const content = typeof input?.content === 'string' ? input.content : ''
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, 'utf8')
  return {
    folderName,
    relativePath,
  }
}

async function createWorkspacePackFolder(input) {
  const { folderName, packDir, relativePath, absolutePath } = resolveWorkspacePackPath(
    input?.folderName,
    input?.relativePath,
  )
  await assertWorkspacePackDirExists(packDir, folderName)

  let stat
  try {
    stat = await fs.stat(absolutePath)
  } catch {
    stat = null
  }
  if (stat?.isFile()) {
    throw new Error(`目标路径已存在文件: ${folderName}/${relativePath}`)
  }

  await fs.mkdir(absolutePath, { recursive: true })
  return {
    folderName,
    relativePath,
  }
}

async function renameWorkspacePackPath(input) {
  const source = resolveWorkspacePackPath(input?.folderName, input?.oldRelativePath)
  const target = resolveWorkspacePackPath(input?.folderName, input?.newRelativePath)

  await assertWorkspacePackDirExists(source.packDir, source.folderName)

  if (source.relativePath === target.relativePath) {
    return {
      folderName: source.folderName,
      oldRelativePath: source.relativePath,
      newRelativePath: target.relativePath,
    }
  }

  let sourceStat
  try {
    sourceStat = await fs.stat(source.absolutePath)
  } catch {
    throw new Error(`目标不存在: ${source.folderName}/${source.relativePath}`)
  }

  if (!sourceStat.isFile() && !sourceStat.isDirectory()) {
    throw new Error(`目标不可重命名: ${source.folderName}/${source.relativePath}`)
  }

  try {
    await fs.stat(target.absolutePath)
    throw new Error(`目标路径已存在: ${source.folderName}/${target.relativePath}`)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('目标路径已存在')) {
      throw error
    }
  }

  await fs.mkdir(path.dirname(target.absolutePath), { recursive: true })
  await fs.rename(source.absolutePath, target.absolutePath)

  return {
    folderName: source.folderName,
    oldRelativePath: source.relativePath,
    newRelativePath: target.relativePath,
  }
}

async function deleteWorkspacePackPath(input) {
  const { folderName, packDir, relativePath, absolutePath } = resolveWorkspacePackPath(
    input?.folderName,
    input?.relativePath,
  )
  await assertWorkspacePackDirExists(packDir, folderName)

  let stat
  try {
    stat = await fs.stat(absolutePath)
  } catch {
    throw new Error(`目标不存在: ${folderName}/${relativePath}`)
  }

  if (stat.isDirectory()) {
    const recursive = input?.recursive === true
    if (!recursive) {
      throw new Error(`目录删除需要 recursive=true: ${folderName}/${relativePath}`)
    }
    await fs.rm(absolutePath, { recursive: true, force: false })
  } else if (stat.isFile()) {
    await fs.unlink(absolutePath)
  } else {
    throw new Error(`目标不可删除: ${folderName}/${relativePath}`)
  }

  return {
    folderName,
    relativePath,
  }
}

async function listWorkspacePackFiles(input) {
  const { folderName, packDir } = resolveWorkspacePackDir(input?.folderName)
  await assertWorkspacePackDirExists(packDir, folderName)

  const files = []

  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name)
      if (entry.isSymbolicLink()) {
        continue
      }

      if (entry.isDirectory()) {
        const relativePath = path.relative(packDir, absolutePath).replace(/\\/g, '/')
        if (relativePath) {
          files.push({
            relativePath,
            size: 0,
            ext: '',
            isDirectory: true,
          })
        }
        await walk(absolutePath)
        continue
      }

      if (!entry.isFile()) {
        continue
      }

      const stat = await fs.stat(absolutePath)
      const relativePath = path.relative(packDir, absolutePath).replace(/\\/g, '/')
      const ext = path.extname(entry.name).replace(/^\./, '').toLowerCase()
      files.push({
        relativePath,
        size: stat.size,
        ext,
        isDirectory: false,
      })
    }
  }

  await walk(packDir)
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath))

  return {
    folderName,
    files,
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
    let filePath = resolvePackFilePath(tail)

    // Dev mode: base pack served from source directory
    if (filePath && !(await pathExists(filePath))) {
      const slashIndex = tail.indexOf('/')
      const folderName = slashIndex === -1 ? tail : tail.slice(0, slashIndex)
      if (folderName === BASE_PACK_FOLDER) {
        const baseDir = await findBundledBasePackDir()
        if (baseDir) {
          const baseRelative = slashIndex === -1 ? '' : tail.slice(slashIndex + 1)
          const raw = String(baseRelative ?? '')
          if (!hasTraversalSegment(raw)) {
            const sourcePath = path.join(baseDir, path.normalize(raw))
            if (await pathExists(sourcePath)) filePath = sourcePath
          }
        }
      }
    }

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
  // Every manager handler, including legacy workspace/download/updater APIs, shares this guard.
  const handle = (channel, handler) =>
    ipcMain.handle(channel, (event, ...args) => {
      requireLocalBattleCaller(event)
      return handler(event, ...args)
    })
  ipcMain.handle('remote-play:get-boot-config', event => remotePlay.getBootConfig(event))
  ipcMain.handle('remote-play:close', event => remotePlay.close(event))
  handle('desktop:open-remote-play', (_event, input) => remotePlay.open(input?.url))
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
      else if (input.action === 'create') result = await manager.create(input.name)
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
        else if (input.action === 'close') result = await manager.release(input.id)
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
              result = session.jobs.list()
              break
            case 'start':
              result = await session.jobs.start({ kind: input.kind })
              break
            case 'cancel':
              result = session.jobs.cancel(input.jobId)
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
    if (input.action === 'start') {
      await library.start()
      return null
    }
    throw new Error('不支持的内容包操作')
  })
  handle('desktop:select-and-start-local-battle', async event => {
    requireLocalBattleCaller(event)
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: '选择已安装并准入的服务器项目',
      properties: ['openDirectory'],
    })
    requireLocalBattleCaller(event)
    if (selected.canceled || !selected.filePaths[0]) return { status: 'cancelled' }
    try {
      return await localBattleHost.start(selected.filePaths[0])
    } catch (error) {
      return {
        status: 'failed',
        code: error?.code ?? 'SERVER_START_FAILED',
        message: error?.message ?? '本机服务启动失败',
      }
    }
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
    if (input.action === 'start') return manager.start(input.id)
    if (input.action === 'export') {
      const selected = await dialog.showSaveDialog(mainWindow, { title: '导出到新的环境目录', buttonLabel: '导出环境' })
      requireLocalBattleCaller(event)
      if (selected.canceled || !selected.filePath) return null
      await manager.export(input.id, selected.filePath, input.includeLocalArtifacts === true)
      return true
    }
    return manager.operate(input.id, input.action, { offline: input.offline === true })
  })
  handle('desktop:stop-local-battle', event => {
    requireLocalBattleCaller(event)
    return localBattleHost.stop()
  })
  handle('desktop:read-work-workspace', async () => (await getCreatorWorkStorage()).read())
  handle('desktop:write-work-workspace', async (_event, input) => {
    if (!Number.isSafeInteger(input?.expected) || input.expected < 0) throw new Error('Invalid workspace revision')
    return (await getCreatorWorkStorage()).compareAndSwap(input.expected, input.workspace)
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

  handle('desktop:list-pack-templates', () => listPackTemplates())
  handle('desktop:list-workspace-packs', async () => buildWorkspaceIndex())
  handle('desktop:create-pack-from-template', async (_event, input) => createPackFromTemplate(input))
  handle('desktop:set-workspace-pack-enabled', async (_event, input) => setWorkspacePackEnabled(input))
  handle('desktop:read-workspace-pack-manifest', async (_event, input) => readWorkspacePackManifest(input))
  handle('desktop:write-workspace-pack-manifest', async (_event, input) => writeWorkspacePackManifest(input))
  handle('desktop:list-workspace-pack-files', async (_event, input) => listWorkspacePackFiles(input))
  handle('desktop:read-workspace-pack-file', async (_event, input) => readWorkspacePackFile(input))
  handle('desktop:write-workspace-pack-file', async (_event, input) => writeWorkspacePackFile(input))

  handle('desktop:read-all-base-pack-data', async () => {
    const baseDir = await findBundledBasePackDir()
    if (!baseDir) throw new Error('Base pack source directory not found')

    const manifest = JSON.parse(await fs.readFile(path.join(baseDir, 'pack.json'), 'utf8'))
    const dataDir = path.join(baseDir, manifest.paths?.dataDir || '.')

    const result = {}
    const kinds = ['species', 'skills', 'marks', 'effects']
    for (const kind of kinds) {
      const files = Array.isArray(manifest.data?.[kind]) ? manifest.data[kind] : []
      const allRecords = []
      for (const file of files) {
        const filePath = path.join(dataDir, file)
        if (!(await pathExists(filePath))) continue
        try {
          const content = await fs.readFile(filePath, 'utf8')
          const parsed = parseYaml(content, { merge: true })
          if (Array.isArray(parsed)) {
            allRecords.push(...parsed)
          }
        } catch (e) {
          console.warn(`Failed to parse ${file}:`, e.message)
        }
      }
      result[kind] = allRecords
    }
    return result
  })

  handle('desktop:write-base-pack-file', async (_event, input) => {
    const baseDir = await findBundledBasePackDir()
    if (!baseDir) throw new Error('Base pack source directory not found')

    const relativePath = sanitizeWorkspaceRelativePath(input?.relativePath)
    if (!relativePath) throw new Error('relativePath 非法')

    const filePath = path.join(baseDir, relativePath)
    if (!filePath.startsWith(baseDir)) throw new Error('relativePath 非法')

    const content = typeof input?.content === 'string' ? input.content : ''
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, content, 'utf8')
    return { relativePath }
  })

  handle('desktop:read-base-pack-file', async (_event, input) => {
    const baseDir = await findBundledBasePackDir()
    if (!baseDir) throw new Error('Base pack source directory not found')

    const relativePath = sanitizeWorkspaceRelativePath(input?.relativePath)
    if (!relativePath) throw new Error('relativePath 非法')

    const filePath = path.join(baseDir, relativePath)
    if (!filePath.startsWith(baseDir)) throw new Error('relativePath 非法')

    const content = await fs.readFile(filePath, 'utf8')
    return { relativePath, content }
  })
  handle('desktop:create-workspace-pack-folder', async (_event, input) => createWorkspacePackFolder(input))
  handle('desktop:rename-workspace-pack-path', async (_event, input) => renameWorkspacePackPath(input))
  handle('desktop:delete-workspace-pack-path', async (_event, input) => deleteWorkspacePackPath(input))

  handle('desktop:get-app-version', () => app.getVersion())
  handle('desktop:check-for-updates', async () => checkForUpdates())
  handle('desktop:download-and-install-update', async () => downloadAndInstallUpdate())

  handle('desktop:get-base-pack-dir', async () => {
    const dir = await findBundledBasePackDir()
    if (!dir) throw new Error('Base pack directory not found')
    return dir
  })

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
  stoppingForQuit ??= stopForQuit(
    [
      () => swfHost.dispose(),
      () => remotePlay.destroy(),
      () => contentLibrary?.close(),
      () => contentProjects?.close(),
      () => authorWorkspaces?.close(),
      () => localBattleHost.stop(),
      () => stopLocalServer(),
    ],
    {
      forceStop: () => localBattleHost.forceStop(),
    },
  ).finally(() => {
    stoppedForQuit = true
    app.quit()
  })
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
