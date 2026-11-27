import { mediaMimeForFile } from '../shared/media-formats.mjs'
import { app, BrowserWindow, Menu, shell, ipcMain, dialog, session } from 'electron'
import type { ContextMenuParams, IpcMainInvokeEvent, MenuItemConstructorOptions, WebContents } from 'electron'
import { createRequire } from 'node:module'
import { isDeepStrictEqual } from 'node:util'
import http from 'node:http'
import type { IncomingMessage, OutgoingHttpHeaders, Server, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promises as fs } from 'node:fs'
import { desktopMediaCache } from './media-cache.ts'
import { LocalBattleHost } from './local-battle-host.ts'
import { LocalServerController } from './local-server-controller.ts'
import { readLocalBuiltinEnvironmentId } from './local-server-profile.ts'
import { isTrustedDesktopRequest } from './local-battle-ipc.ts'
import { createRemotePlayController, protectDesktopNavigation, normalizeRemoteBackend } from './remote-play.ts'
import { createSwfHost } from './swf-host.ts'
import { CLIENT_URL, CLIENT_ORIGIN, registerClientProtocol } from './client-protocol.ts'
import { stopForQuit } from './shutdown.ts'
import { ContentProjectManager, runContentCommand } from './content-projects.ts'
import { playerLibraryRoute, registerPlayerLibrary } from './player-library-bridge.ts'
import { ContentLibrary, readDesktopContentSources } from './content-library.ts'
import { createAuthorPreviewSessions } from './author-preview-sessions.ts'
import { notifyAuthorPreviewChange } from './author-preview-events.ts'
import { CreatorGitHub, creatorAction, type CreatorActionInput } from './creator-github.ts'
import { AuthorWorkspaces, type AuthorApi, type AuthorJob, type AuthorSession } from './author-workspaces.ts'
import { createLocalContentSessions, type LocalContentRuntime } from './local-content-sessions.ts'
import { bindLocalContentOwner } from './local-content-owner.ts'
import {
  activateOfficialEnvironments,
  createOfficialContentUpdater,
  openBuiltinEnvironment,
} from './builtin-environment.ts'
import { LocalEnvironments } from './local-environments.ts'
import { DesktopWorkshop, type WorkshopRequest } from './workshop.ts'
import { DesktopWorkspaceOwner } from './desktop-workspace-owner.ts'
import { protectStandardStreams } from './stdio.ts'
import type { ArcadiaDesktopApi, ContentProjectAction } from '../src/types/desktop.d.ts'
import type { ContentPackageAction } from '../src/types/contentPackages.ts'
import type { OwnedContentWorkspace } from '@arcadia-eternity/content-sdk/management-workspace'

type RuntimeModules = {
  '@arcadia-eternity/content-sdk/workspace': AuthorApi
  '@arcadia-eternity/local-profile': typeof import('@arcadia-eternity/local-profile')
  '@arcadia-eternity/local-profile/node': typeof import('@arcadia-eternity/local-profile/node')
  '@arcadia-eternity/content-sdk/managed-projects': typeof import('@arcadia-eternity/content-sdk/managed-projects')
  '@arcadia-eternity/content-sdk/management-workspace': typeof import('@arcadia-eternity/content-sdk/management-workspace')
  '@arcadia-eternity/pack-loader/node': typeof import('@arcadia-eternity/pack-loader/node')
  '@arcadia-eternity/pack-loader/native': typeof import('@arcadia-eternity/pack-loader/native')
  '@arcadia-eternity/server': typeof import('@arcadia-eternity/server')
  '@arcadia-eternity/database': typeof import('@arcadia-eternity/database')
}

function loadRuntimeModule<Name extends keyof RuntimeModules>(name: Name): Promise<RuntimeModules[Name]> {
  return import(pathToFileURL(runtimeRequire.resolve(name)).href)
}

type ProfileModule = RuntimeModules['@arcadia-eternity/local-profile']
type PersonalProfile = {
  storage: InstanceType<RuntimeModules['@arcadia-eternity/local-profile/node']['FileProfileStorage']>
  repository: InstanceType<ProfileModule['ProfileRepository']>
  validateEnvelope: ProfileModule['validateEnvelope']
  validateData: ProfileModule['validateData']
}

type DesktopError = Error & { code?: string; file?: string }

type DesktopInput<Name extends keyof ArcadiaDesktopApi> =
  NonNullable<ArcadiaDesktopApi[Name]> extends (...args: infer Args) => unknown ? Args[0] : never

type AuthorProjectRequest = { id: string } & (
  | { action: 'forget' | 'close' | 'export' | 'snapshot' | 'jobs' | 'sdk' | 'update-author-lock' }
  | { action: 'git'; operation: string; githubApp?: boolean; [key: string]: unknown }
  | { action: 'install-built-author-pack' | 'cancel'; jobId: string }
  | { action: 'context'; state: unknown }
  | { action: 'edit-package'; [key: string]: unknown }
  | { action: 'save-arcadia-range'; range: string; expectedRange: string }
  | { action: 'dependency-references'; locale: string }
  | ({ action: 'save-changes' } & Parameters<AuthorSession['workspace']['saveChanges']>[0])
  | { action: 'dirty' | 'media'; file: string; dirty?: boolean }
  | { action: 'import-asset' }
  | { action: 'start'; kind: string }
  | { action: 'preview-open'; jobId: string; requireCurrent?: boolean }
  | { action: 'show'; file?: string }
  | { action: 'editor'; file?: string; editor: string; line?: number; column?: number }
  | { action: 'connection'; execute?: boolean }
)

type AuthorRequest =
  | AuthorProjectRequest
  | { action: 'list' }
  | { action: 'open' }
  | { action: 'terminal-command-paths' }
  | { action: 'browse-package'; packageId: string }
  | { action: 'create'; name: string; arcadiaRange?: string }
  | ({ action: 'creator-github' } & CreatorActionInput)
  | { action: 'git-cancel'; id: string }
  | { action: 'clone'; url: unknown }

const localServerStateDirectory = path.join(app.getPath('userData'), 'local-server')

protectStandardStreams()

let playerLibraryBridge: Awaited<ReturnType<typeof registerPlayerLibrary>> | undefined

const require = createRequire(import.meta.url)
// The installed server runtime and its dependencies live outside app.asar.
const runtimeRequire = app.isPackaged
  ? createRequire(path.join(process.resourcesPath, 'arcadia-server/package.json'))
  : require
const { autoUpdater }: typeof import('electron-updater') = require('electron-updater')

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const appIconPath = path.join(__dirname, 'icon.png')
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
  stateDirectory: localServerStateDirectory,
  workspaceRoot: path.join(app.getPath('userData'), 'content-packages'),
  officialBaseRoot: () => contentLibrary?.officialPackageRoot,
  attachWorkspace: (child, publish) =>
    getManagementWorkspaceOwner().attach(child, publish ? () => getLocalEnvironments().hostingWorkspace() : undefined),
  ...(app.isPackaged
    ? {
        npmCliPath: path.join(process.resourcesPath, 'arcadia-server', 'runtime', 'npm', 'bin', 'npm-cli.js'),
        packsDirectory: path.join(process.resourcesPath, 'arcadia-server', 'packs'),
      }
    : {}),
})

const localServerController = new LocalServerController({
  host: localBattleHost,
  defaultProject: async () => {
    const workspace = await getManagementWorkspaceOwner().ready()
    await builtinSync
    const installation = await workspace.getInstallation(builtinEnvironment!.id)
    return installation!.directory
  },
})

let personalProfile: Promise<PersonalProfile> | undefined
let personalProfileBusy = true
async function getPersonalProfile() {
  if (!personalProfile)
    personalProfile = (async () => {
      const { ProfileRepository, validateEnvelope, validateData } = await loadRuntimeModule(
        '@arcadia-eternity/local-profile',
      )
      const { FileProfileStorage } = await loadRuntimeModule('@arcadia-eternity/local-profile/node')
      const storage = new FileProfileStorage(path.join(app.getPath('userData'), 'profile'))
      await storage.acquireOwner()
      return { storage, repository: new ProfileRepository(storage), validateEnvelope, validateData }
    })().catch(error => {
      personalProfile = undefined
      throw error
    })
  return personalProfile
}
const windowsWithTeamDrafts = new Set<BrowserWindow>()

function confirmDraftExit(window: BrowserWindow) {
  return (
    dialog.showMessageBoxSync(window, {
      type: 'warning',
      message: '离开会丢失尚未保存的队伍草稿。',
      buttons: ['继续编辑', '放弃并离开'],
      defaultId: 0,
      cancelId: 0,
    }) === 1
  )
}

function guardTeamDrafts(window: BrowserWindow) {
  window.on('closed', () => windowsWithTeamDrafts.delete(window))
  window.webContents.on('will-prevent-unload', event => {
    if (windowsWithTeamDrafts.has(window) && (stoppedForQuit || confirmDraftExit(window))) event.preventDefault()
  })
  window.webContents.on('did-navigate', () => windowsWithTeamDrafts.delete(window))
}
const remotePlay = createRemotePlayController({
  onWindow: guardTeamDrafts,
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
    return (['cancel', 'save', 'discard'] as const)[result.response]
  },
  readProfile: async () => (await (await getPersonalProfile()).repository.open())?.current ?? null,
  saveProfile: async input => {
    if (personalProfileBusy) throw new Error('请先在主窗口退出房间、匹配或对局')
    const { repository, validateData } = await getPersonalProfile()
    const data = validateData(input?.data)
    const preview = await repository.inspectImport(JSON.stringify(await repository.exportBackup(data)))
    if (preview.expectedRevision !== input.expectedRevision) throw new Error('个人资料已改变，请重新打开远程窗口')
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error('主窗口不可用')
    const settings = Object.keys(data.settings) as (keyof typeof data.settings)[]
    const answer = await dialog.showMessageBox(mainWindow!, {
      type: 'question',
      message: '保存远程窗口的个人资料？',
      detail: `昵称：${preview.current?.data.profile.name ?? '—'} → ${data.profile.name}\n仓库：${preview.current?.data.library.storage.length ?? 0} → ${data.library.storage.length}\n队伍：${preview.current?.data.library.teams.length ?? 0} → ${data.library.teams.length}\n设置变化：${settings.filter(key => JSON.stringify(data.settings[key]) !== JSON.stringify(preview.current?.data.settings[key])).length} 项`,
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
let mainWindow: BrowserWindow | null = null
let localServer: Server | null = null
let localServerPort: number | null = null
let contentProjects: ContentProjectManager | undefined
let contentLibrary: ContentLibrary | undefined
let managementWorkspaceOwner: DesktopWorkspaceOwner | undefined
let localContentSessions: ReturnType<typeof createLocalContentSessions> | undefined
let localContentRuntime: Promise<LocalContentRuntime> | undefined
let localContentOwner: ReturnType<typeof bindLocalContentOwner> | undefined
let authorWorkspaces: AuthorWorkspaces | undefined
const authorPreviewWindows = new Map<string, BrowserWindow>()
const authorPreviewProjects = new WeakMap<WebContents, string>()
let previewOperation: Promise<unknown> = Promise.resolve()
function withPreviewOperation<Result>(operation: () => Result | Promise<Result>) {
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
async function openAuthorPreview(id: string, job: AuthorJob) {
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
    title: '调试试玩',
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
  const url = new URL('/creation/preview', rendererUrl)
  url.searchParams.set('endpoint', job.result.preview.endpoint)
  try {
    await window.loadURL(url.href)
  } catch (error) {
    window.destroy()
    throw error
  }
}
const creatorGitHub = new CreatorGitHub({ clientId: process.env.ARCADIA_CREATOR_GITHUB_CLIENT_ID })
function getAuthorWorkspaces() {
  authorWorkspaces ??= new AuthorWorkspaces({
    root: path.join(app.getPath('userData'), 'ugc'),
    installedPackage: id => getContentLibrary().authorProject(id),
    api: () => loadRuntimeModule('@arcadia-eternity/content-sdk/workspace'),
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
function activeBaseRoot() {
  return (
    contentLibrary?.officialPackageRoot ??
    path.dirname(runtimeRequire.resolve('@arcadia-eternity/data-pack-base/package.json'))
  )
}
function loadPackageUpdates() {
  return loadRuntimeModule('@arcadia-eternity/content-sdk/managed-projects')
}
function getContentLibrary() {
  if (contentLibrary) return contentLibrary
  const root = path.join(app.getPath('userData'), 'content-packages')
  const shippedRoot = path.dirname(runtimeRequire.resolve('@arcadia-eternity/data-pack-base/package.json'))
  const loadWorkspace = () => loadRuntimeModule('@arcadia-eternity/content-sdk/management-workspace')
  contentLibrary ??= new ContentLibrary({
    root,
    packageUpdates: {
      clientVersion: app.isPackaged ? app.getVersion() : require('../package.json').version,
      find: async (...args) => {
        const { findPackageUpdate } = await loadPackageUpdates()
        return findPackageUpdate(...args)
      },
      shippedRoot,
      shippedCatalog: async () => {
        const { readOfficialEnvironments } = await loadWorkspace()
        return readOfficialEnvironments(shippedRoot, runtimeRequire.resolve)
      },
      stageShippedEnvironments: async (directory, version) => {
        const { stageBundledOfficialEnvironmentPackages } = await loadWorkspace()
        return stageBundledOfficialEnvironmentPackages(version, directory, runtimeRequire.resolve)
      },
      readEnvironments: async directory => {
        const { readInstalledOfficialEnvironments } = await loadWorkspace()
        return readInstalledOfficialEnvironments(
          path.join(directory, 'node_modules', '@arcadia-eternity/data-pack-base'),
          directory,
        )
      },
      catalogDigest: async root => {
        const { catalogMaterialDigest } = await loadRuntimeModule('@arcadia-eternity/pack-loader/node')
        return catalogMaterialDigest(root)
      },
      withArchive: async (candidate, signal, use) => {
        const { withOfficialUpdateArchive } = await loadPackageUpdates()
        return withOfficialUpdateArchive(candidate, localBattleHost.npmCliPath, signal, use)
      },
      validate: async (directory, signal, catalog) => {
        const { validateWorkspaceProject } = await loadRuntimeModule('@arcadia-eternity/server')
        for (const draft of catalog.environments)
          await validateWorkspaceProject({ directory, signal, draft }, { effectPreparation: 'prebuilt-only' })
      },
    },
    sources: readDesktopContentSources(process.argv.slice(1), root),
    reviewInstall: async (pkg, signal) => {
      const ranges = Object.entries(pkg.dependencyRanges).map(([name, range]) => name + ' ' + range)
      const { response } = await dialog.showMessageBox(mainWindow!, {
        type: 'question',
        buttons: ['取消', '安装'],
        defaultId: 1,
        cancelId: 0,
        message: `安装 ${pkg.name}@${pkg.version}？`,
        detail: [
          pkg.projectId + ' · ' + pkg.namespace,
          pkg.source.label,
          'Arcadia ' + (pkg.engines?.arcadia || '未声明') + ' · SDK API ' + (pkg.sdkApi ?? '未声明'),
          '运行依赖：' + (ranges.join('、') || '无'),
        ].join('\n'),
        signal,
      })
      return response === 1
    },
    authorizeEnvironment: async (document, effects, signal) => {
      const { response } = await dialog.showMessageBox(mainWindow!, {
        type: 'question',
        buttons: ['取消', '允许此环境使用'],
        defaultId: 0,
        cancelId: 0,
        message: `允许「${document.name}」在本机运行以下内容包的效果？`,
        detail: effects.map(pkg => pkg.name + '@' + pkg.version).join('\n'),
        signal,
      })
      return response === 1
    },
    host: localBattleHost,
    copyMember: async (...args) => {
      const { copyEnvironmentMember } = await loadRuntimeModule('@arcadia-eternity/content-sdk/management-workspace')
      return copyEnvironmentMember(...args)
    },
    withDefaultArchive: async use => {
      const { withShippedCatalogArchive } = await loadRuntimeModule('@arcadia-eternity/pack-loader/node')
      return withShippedCatalogArchive(shippedRoot, localBattleHost.npmCliPath, use)
    },
    createManagedProjects: async (root, options) => {
      const { ManagedProjects } = await loadPackageUpdates()
      return new ManagedProjects(root, {
        ...options,
        get bundledPackageRoot() {
          return activeBaseRoot()
        },
      })
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
let builtinEnvironment: Awaited<ReturnType<typeof openBuiltinEnvironment>> | undefined
let workshop: DesktopWorkshop | undefined
function getWorkshop() {
  workshop ??= new DesktopWorkshop({
    directory: path.join(app.getPath('userData'), 'workshop'),
    host: {
      listPackages: async () => (await getContentLibrary().list()).packages,
      installPackage: (spec, verify) => getContentLibrary().installNpm(spec, false, verify),
      installEnvironment: (spec, environmentId, verify) =>
        getLocalEnvironments().installRecipe(
          { kind: 'npm', spec },
          { ...(environmentId && { environmentId }), allowDownload: true, verify },
        ),
    },
  })
  return workshop
}
let localEnvironments: LocalEnvironments | undefined
function getLocalEnvironments() {
  localEnvironments ??= new LocalEnvironments({
    openBuiltin: async () => {
      await getManagementWorkspaceOwner().ready()
      return builtinEnvironment
    },
    baseRules: runtimeRequire('@arcadia-eternity/environment-default/package.json').arcadiaEnvironment.rules,
    library: getContentLibrary(),
    acquireRecipe: async (source, destination, options) => {
      const { acquireAuthorEnvironment, parseAuthorEnvironmentNpmSpec } = await loadRuntimeModule(
        '@arcadia-eternity/content-sdk/management-workspace',
      )
      return acquireAuthorEnvironment(
        source.kind === 'npm' ? parseAuthorEnvironmentNpmSpec(source.spec) : source,
        destination,
        {
          ...options,
          clientVersion: app.isPackaged ? app.getVersion() : require('../package.json').version,
          cache: path.join(app.getPath('userData'), 'content-packages', 'acquisition', 'npm-cache'),
        },
      )
    },
    resolvePackageChange: async (workspace, input) => {
      const { resolveEnvironmentPackageChange } = await loadRuntimeModule(
        '@arcadia-eternity/content-sdk/management-workspace',
      )
      return resolveEnvironmentPackageChange(workspace, input)
    },
    openWorkspace: async () => {
      const { ContentWorkspace } = await loadRuntimeModule('@arcadia-eternity/content-sdk/management-workspace')
      // Local play and hosting borrow read leases. Persistent server bindings belong to the management workspace.
      return ContentWorkspace.open(path.join(app.getPath('userData'), 'local-environments'), {
        allowShareDownloads: true,
        get bundledPackageRoot() {
          return activeBaseRoot()
        },
        npmCache: path.join(app.getPath('userData'), 'content-packages', 'acquisition', 'npm-cache'),
        retentions: { list: async () => [] },
      })
    },
    validate: async input => {
      const { validateWorkspaceProject } = await loadRuntimeModule('@arcadia-eternity/server')
      return validateWorkspaceProject(input)
    },
  })
  return localEnvironments
}

let builtinSync = Promise.resolve()
let updateOfficialContent: ReturnType<typeof createOfficialContentUpdater>
let stopAutomaticContentUpdates:
  | ReturnType<RuntimeModules['@arcadia-eternity/content-sdk/managed-projects']['startAutomaticContentUpdates']>
  | undefined
function synchronizeDesktopEnvironments(workspace: OwnedContentWorkspace, reportFailure = false) {
  const current = builtinSync.then(async () => {
    const library = getContentLibrary()
    await library.resume()
    await activateOfficialEnvironments(library, () => refreshDesktopEnvironments(workspace), reportFailure)
  })
  builtinSync = current.catch(() => {})
  return current
}
async function refreshDesktopEnvironments(workspace: OwnedContentWorkspace) {
  const { validateWorkspaceProject } = await loadRuntimeModule('@arcadia-eternity/server')
  const library = getContentLibrary()
  const { synchronizeShippedEnvironments } = await loadRuntimeModule(
    '@arcadia-eternity/content-sdk/management-workspace',
  )
  const catalog = await library.officialEnvironmentCatalog()
  const previousEnvironmentId = await readLocalBuiltinEnvironmentId(
    localServerStateDirectory,
    workspace.workspaceId,
    async input => {
      const { openStorage } = await loadRuntimeModule('@arcadia-eternity/database')
      return openStorage(input)
    },
  )
  await workspace.refreshBuiltinRules(catalog.environments)
  builtinEnvironment = await openBuiltinEnvironment({
    workspace,
    library,
    validate: validateWorkspaceProject,
    catalog,
    previousEnvironmentId,
    synchronizeShippedEnvironments,
  })
  await localBattleHost.refreshBuiltinBindings()
}
function getManagementWorkspaceOwner() {
  managementWorkspaceOwner ??= new DesktopWorkspaceOwner({
    root: path.join(app.getPath('userData'), 'content-packages'),
    builtinId: () => builtinEnvironment?.id,
    library: getContentLibrary(),
    synchronize: synchronizeDesktopEnvironments,
    openWorkspace: async (root, options) => {
      const { ContentWorkspace } = await loadRuntimeModule('@arcadia-eternity/content-sdk/management-workspace')
      return ContentWorkspace.open(root, {
        ...options,
        allowShareDownloads: true,
        get bundledPackageRoot() {
          return activeBaseRoot()
        },
      })
    },
  })
  return managementWorkspaceOwner
}
async function loadLocalContentRuntime() {
  localContentRuntime ??= (async () => {
    const [node, native] = await Promise.all([
      loadRuntimeModule('@arcadia-eternity/pack-loader/node'),
      loadRuntimeModule('@arcadia-eternity/pack-loader/native'),
    ])
    return {
      host: node.emptyNpmContentHost,
      prepareNpmProject: node.prepareNpmProject,
      gameplayRevision: native.gameplayRevision,
      environmentVersion: native.environmentVersion,
      buildDisplayCatalog: native.buildDisplayCatalog,
      buildDisplayLocales: native.buildDisplayLocales,
      mapPresentationResources: native.mapPresentationResources,
    }
  })().catch(error => {
    localContentRuntime = undefined
    throw error
  })
  return localContentRuntime
}
function getLocalContentSessions() {
  localContentSessions ??= createLocalContentSessions({
    library: { acquireProject: id => getLocalEnvironments().acquireProject(id) },
    load: loadLocalContentRuntime,
    assetUrl: (token, hash) => `http://127.0.0.1:${localServerPort}/local-content/${token}/${hash}`,
  })
  return localContentSessions
}
function getContentProjects() {
  contentProjects ??= new ContentProjectManager({
    file: path.join(app.getPath('userData'), 'content-projects.json'),
    run: (args, signal) => runContentCommand(localBattleHost, args, signal),
  })
  return contentProjects
}
function buildContextMenuTemplate(window: BrowserWindow, params: ContextMenuParams) {
  const template: MenuItemConstructorOptions[] = []
  const editFlags: Partial<ContextMenuParams['editFlags']> = params.editFlags ?? {}
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

async function isEditorContextAtPoint(window: BrowserWindow, x: number, y: number) {
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

function setupContextMenu(window: BrowserWindow) {
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

function detectContentType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase()
  switch (extension) {
    case '.json':
      return 'application/json'
    case '.yaml':
    case '.yml':
      return 'application/yaml'
    default:
      return mediaMimeForFile(filePath) ?? 'application/octet-stream'
  }
}

function sendResponse(res: ServerResponse, statusCode: number, body: Buffer, headers: OutgoingHttpHeaders = {}) {
  res.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    ...headers,
  })
  res.end(body)
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  sendResponse(res, statusCode, Buffer.from(JSON.stringify(payload)), {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  })
}

async function sendFile(res: ServerResponse, filePath: string) {
  const content = await fs.readFile(filePath)
  sendResponse(res, 200, content, {
    'Content-Type': detectContentType(filePath),
    'Cache-Control': 'no-store',
  })
}

function isPortAvailable(port: number) {
  return new Promise<boolean>(resolve => {
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

async function handleLocalServerRequest(req: IncomingMessage, res: ServerResponse) {
  if (!req.url) {
    sendJson(res, 400, { error: 'invalid request' })
    return
  }

  if (req.url === playerLibraryRoute) {
    if (!playerLibraryBridge) return sendJson(res, 503, { error: { code: 'PLAYER_LIBRARY_CLOSED' } })
    return playerLibraryBridge.handle(req, res)
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

  sendJson(res, 404, { error: 'not found' })
}

async function startLocalServer() {
  const port = await findAvailablePort()
  if (!port) {
    throw new Error('无法找到可用端口')
  }

  localServerPort = port

  const server = http.createServer((req, res) => {
    void handleLocalServerRequest(req, res).catch(error => {
      console.error('Local server request failed:', error)
      sendJson(res, 500, { error: 'internal server error' })
    })
  })

  localServer = server
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })

  console.log(`Local desktop server started at http://127.0.0.1:${port}`)
  return port
}

async function stopLocalServer() {
  const server = localServer
  if (!server) return
  await new Promise<void>(resolve => {
    server.close(() => resolve())
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
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { hasUpdate: false }
    throw error
  }

  const result = await autoUpdater.checkForUpdates()
  const version = result?.updateInfo?.version
  const hasUpdate = result?.isUpdateAvailable === true && typeof version === 'string'

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
  const handle = <Args extends unknown[]>(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: Args) => unknown,
  ) =>
    ipcMain.handle(channel, (event, ...incoming) => {
      const args = incoming as Args
      requireLocalBattleCaller(event)
      return handler(event, ...args)
    })
  handle('desktop:profile', async (_event, input: DesktopInput<'profile'>) => {
    try {
      if (input?.action === 'activity') {
        personalProfileBusy = input.busy !== false
        return { value: true }
      }
      const { storage, repository, validateEnvelope } = await getPersonalProfile()
      if (input?.action === 'read') return { value: await storage.read() }
      if (input?.action === 'raw') return { value: await storage.readRaw() }
      if (input?.action === 'commit' && input.expected && 'legacy' in Object(input.expected)) {
        // The main process validates and derives the migration from the exact owned bytes.
        if ((await storage.readRaw()) !== (input.expected as { legacy: string }).legacy)
          throw Object.assign(new Error('REVISION_CONFLICT'), { code: 'REVISION_CONFLICT' })
        const migrated = await repository.open()
        if (!isDeepStrictEqual(migrated, await validateEnvelope(input.next))) throw new Error('Invalid migration')
        return { value: true }
      }
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
      const problem = error as DesktopError
      return { error: { code: problem.code ?? 'STORAGE_DENIED', message: problem.message } }
    }
  })
  handle('desktop:local-server', (_event, input: DesktopInput<'localServer'>) => localServerController.request(input))
  handle('desktop:local-environment', async (event, input: unknown) => {
    try {
      const result = await getLocalEnvironments().request(input, {
        chooseRecipeArchive: async () => {
          requireLocalBattleCaller(event)
          const selected = await dialog.showOpenDialog(mainWindow!, {
            title: '安装环境包',
            properties: ['openFile'],
            filters: [{ name: '环境包', extensions: ['tgz'] }],
          })
          requireLocalBattleCaller(event)
          return selected.canceled ? null : selected.filePaths[0]
        },
      })
      return { result }
    } catch (error) {
      const problem = error as DesktopError
      return { error: { code: problem.code ?? 'ENVIRONMENT_FAILED', message: problem.message ?? '环境操作失败' } }
    }
  })
  handle('desktop:workshop', async (_event, input: WorkshopRequest) => {
    try {
      return { result: await getWorkshop().request(input) }
    } catch (error) {
      const problem = error as DesktopError
      return { error: { code: problem.code ?? problem.message ?? 'WORKSHOP_FAILED', message: problem.message } }
    }
  })
  handle('desktop:management-request', (_event, input: DesktopInput<'managementRequest'>) =>
    localBattleHost.managementRequest(input),
  )
  ipcMain.handle('author-preview:environment', async (event, action, input) => {
    const window = [...authorPreviewWindows.values()].find(window =>
      isTrustedDesktopRequest(event, window.webContents, rendererUrl),
    )
    if (!window) throw new Error('Unauthorized preview frame')
    const id = authorPreviewProjects.get(window.webContents)!,
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
        if (session.workspace.projectKind !== 'environment') await manager.previewEnvironment(id, input.environmentId)
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
    return getAuthorWorkspaces().teamLibrary(authorPreviewProjects.get(window.webContents)!, action, input)
  })
  ipcMain.on('team-draft:pending', (event, pending) => {
    if (!isTrustedDesktopRequest(event, mainWindow?.webContents, rendererUrl) && !remotePlay.isTrusted(event)) return
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    if (pending === true) windowsWithTeamDrafts.add(window)
    else if (pending === false) windowsWithTeamDrafts.delete(window)
  })
  ipcMain.handle('remote-play:get-boot-config', event => remotePlay.getBootConfig(event))
  ipcMain.handle('remote-play:profile-draft', (event, input) => remotePlay.updateProfileDraft(event, input))
  ipcMain.handle('remote-play:save-profile', (event, input) => remotePlay.saveProfile(event, input))
  ipcMain.handle('remote-play:close', event => remotePlay.close(event))
  handle('desktop:open-server-website', (_event, input: DesktopInput<'openServerWebsite'>) =>
    shell.openExternal(normalizeRemoteBackend(input?.url)),
  )
  handle('desktop:open-remote-play', (_event, input: DesktopInput<'openRemotePlay'>) =>
    remotePlay.open(input?.url, { mode: input?.mode }),
  )
  handle('desktop:get-backend-config', () => ({ schemaVersion: 1, backendOrigin: 'https://test-battle.fly.dev' }))
  function requireLocalBattleCaller(event: IpcMainInvokeEvent) {
    if (!isTrustedDesktopRequest(event, mainWindow?.webContents, rendererUrl))
      throw new Error('Unauthorized desktop frame')
  }
  handle('desktop:author', async (event, input: AuthorRequest) => {
    try {
      if (!input || typeof input.action !== 'string') throw new Error('作者操作无效')
      if (input.action === 'terminal-command-paths') {
        if (!app.isPackaged) {
          const windows = process.platform === 'win32'
          const cli = path.join(projectRoot, 'node_modules/.bin', windows ? 'arcadia-content.cmd' : 'arcadia-content')
          return { result: { shell: windows ? 'powershell' : 'posix', commandPaths: { 'arcadia-content': cli } } }
        }
        const modulePath = path.join(process.resourcesPath, 'arcadia-server/bin/desktop-author-cli.mjs')
        const { getDesktopCommandPaths } = await import(pathToFileURL(modulePath).href)
        return { result: await getDesktopCommandPaths(path.join(app.getPath('userData'), 'cli')) }
      }
      const manager = getAuthorWorkspaces()
      let result
      if (input.action === 'list') result = await manager.list()
      else if (input.action === 'browse-package') result = await getContentLibrary().authorProject(input.packageId)
      else if (input.action === 'create') result = await manager.create(input.name, input.arcadiaRange)
      else if (input.action === 'creator-github') {
        result = await creatorAction(creatorGitHub, manager, input, {
          open: url => shell.openExternal(url),
          confirm: async (message, detail) => {
            const { response } = await dialog.showMessageBox(mainWindow!, {
              type: 'question',
              message,
              detail,
              buttons: ['取消', '确认'],
              defaultId: 0,
              cancelId: 0,
            })
            requireLocalBattleCaller(event)
            return response === 1
          },
        })
      } else if (input.action === 'git-cancel') result = manager.cancelGit(input.id)
      else if (input.action === 'clone') result = await manager.clone(input.url)
      else if (input.action === 'open') {
        const choice = await dialog.showOpenDialog(mainWindow!, {
          title: '打开创作项目',
          properties: ['openDirectory'],
        })
        requireLocalBattleCaller(event)
        result = choice.canceled ? null : await manager.add(choice.filePaths[0])
      } else {
        if (typeof input.id !== 'string') throw new Error('项目标识无效')
        if (input.action === 'forget') result = await manager.forget(input.id)
        else if (input.action === 'close') result = await manager.release(input.id, { preservePreviews: true })
        else if (input.action === 'export') {
          const choice = await dialog.showSaveDialog(mainWindow!, {
            title: '导出完整源项目到新目录',
            buttonLabel: '导出项目',
          })
          requireLocalBattleCaller(event)
          result = choice.canceled ? null : await manager.export(input.id, choice.filePath!)
        } else {
          const session = await manager.session(input.id)
          switch (input.action) {
            case 'git': {
              const tokenFor = input.githubApp === true ? creatorGitHub.gitCredentials() : undefined
              if (input.operation === 'push' || input.operation === 'push-tag') {
                const isTag = input.operation === 'push-tag'
                const destination = await manager.git(input.id, { operation: isTag ? 'tag-target' : 'push-target' })
                const { response } = await dialog.showMessageBox(mainWindow!, {
                  type: 'question',
                  buttons: ['取消', '推送'],
                  defaultId: 0,
                  cancelId: 0,
                  message: isTag ? '推送版本标签？' : '推送当前分支？',
                  detail: destination,
                })
                requireLocalBattleCaller(event)
                if (response !== 1) throw new Error('已取消推送')
                result = await manager.git(input.id, { operation: input.operation, destination }, tokenFor)
              } else if (input.operation === 'commit') {
                result = await manager.git(input.id, { ...input, fallbackIdentity: creatorGitHub.commitIdentity() })
              } else result = await manager.git(input.id, input, tokenFor)
              break
            }
            case 'install-built-author-pack':
              result = await manager.installBuiltPack(input.id, input.jobId, file =>
                getContentLibrary().installFile(file),
              )
              break
            case 'import-asset': {
              await session.workspace.assertWritable()
              const choice = await dialog.showOpenDialog(mainWindow!, {
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
            case 'update-author-lock':
              await (await manager.api()).updateAuthorLock(session.workspace)
              break
            case 'edit-package':
              result = await session.workspace.editPackage(input)
              break
            case 'save-arcadia-range':
              result = await session.workspace.saveArcadiaRange(input.range, input.expectedRange)
              break
            case 'snapshot':
              result = await session.workspace.snapshot()
              break
            case 'dependency-references':
              result = await session.dependencyReferences(input.locale)
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
                        environmentId:
                          session.workspace.projectKind === 'environment'
                            ? undefined
                            : await manager.previewEnvironment(input.id),
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
      const problem = error as DesktopError
      return { error: { code: problem.code ?? 'AUTHOR_FAILED', message: problem.message, file: problem.file } }
    }
  })
  handle('desktop:list-content-packages', event => {
    requireLocalBattleCaller(event)
    return getContentLibrary().list()
  })
  function validateLocalEnvironmentId(environmentId: unknown): asserts environmentId is string | undefined {
    if (
      environmentId !== undefined &&
      (typeof environmentId !== 'string' || !environmentId || environmentId.length > 256)
    )
      throw new Error('INVALID_ENVIRONMENT_ID')
  }
  handle('desktop:prepare-local-content', (event, environmentId: unknown) => {
    requireLocalBattleCaller(event)
    validateLocalEnvironmentId(environmentId)
    return getLocalContentSessions().prepare(localContentOwner!.current(), { displayOnly: true, environmentId })
  })
  handle('desktop:read-local-runtime', (_event, token: string) => {
    return getLocalContentSessions().readRuntime(token, localContentOwner!.current())
  })
  handle('desktop:capture-personal-environment', (event, environmentId: unknown) => {
    requireLocalBattleCaller(event)
    validateLocalEnvironmentId(environmentId)
    return getLocalContentSessions().capturePersonalEnvironment(localContentOwner!.current(), environmentId)
  })
  handle('desktop:release-local-content', (event, token: unknown) => {
    requireLocalBattleCaller(event)
    if (typeof token !== 'string') throw new Error('本地内容会话无效')
    return getLocalContentSessions().release(token)
  })
  handle('desktop:install-content-package-file', async (event, options: DesktopInput<'installContentPackageFile'>) => {
    requireLocalBattleCaller(event)
    const selected = await dialog.showOpenDialog(mainWindow!, {
      title: '安装内容包',
      properties: ['openFile'],
      filters: [{ name: '内容包', extensions: ['tgz', 'zip'] }],
    })
    requireLocalBattleCaller(event)
    if (selected.canceled || !selected.filePaths[0]) return null
    return getContentLibrary().installFile(selected.filePaths[0], options?.offline === true)
  })
  handle('desktop:install-npm-content-package', (event, options: DesktopInput<'installNpmContentPackage'>) => {
    requireLocalBattleCaller(event)
    return getContentLibrary().installNpm(options?.spec, options?.offline === true)
  })
  handle('desktop:content-package-action', async (event, input: ContentPackageAction) => {
    requireLocalBattleCaller(event)
    if (!input || typeof input.action !== 'string') throw new Error('内容包操作无效')
    const library = getContentLibrary()
    if (input.action === 'check-update') {
      const candidate = await library.checkPackageUpdate(input.packageId)
      return candidate?.version ?? null
    }
    if (input.action === 'apply-update') {
      if (typeof input.version !== 'string') throw new Error('请选择要更新的版本')
      if (library.isOfficialPackage(input.packageId)) return updateOfficialContent({ expectedVersion: input.version })
      return library.updatePackage(input.packageId, input.version)
    }
    if (input.action === 'install-remote') return library.installRemote(input.source)
    if (input.action === 'cancel-install') {
      library.cancelInstall(input.operationId)
      return null
    }
    if (input.action === 'retry-install') return library.retryInstall(input.operationId)
    if (input.action === 'clear-install-tasks') {
      library.clearInstallTasks()
      return null
    }
    if (input.action === 'uninstall') {
      await getLocalEnvironments().ready()
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
    const selected = await dialog.showOpenDialog(mainWindow!, {
      title: '登记 npm 内容环境',
      properties: ['openDirectory'],
    })
    requireLocalBattleCaller(event)
    if (selected.canceled || !selected.filePaths[0]) return null
    return getContentProjects().add(selected.filePaths[0])
  })
  handle('desktop:content-project-action', async (event, input: ContentProjectAction) => {
    requireLocalBattleCaller(event)
    if (!input || typeof input.id !== 'string') throw new Error('环境标识无效')
    const manager = getContentProjects()
    if (input.action === 'rename') return manager.rename(input.id, input.name)
    if (input.action === 'forget') return manager.forget(input.id)
    if (input.action === 'export') {
      const selected = await dialog.showSaveDialog(mainWindow!, {
        title: '导出到新的环境目录',
        buttonLabel: '导出环境',
      })
      requireLocalBattleCaller(event)
      if (selected.canceled || !selected.filePath) return null
      await manager.export(input.id, selected.filePath, input.includeLocalArtifacts === true)
      return true
    }
    return manager.operate(input.id, input.action, { offline: input.offline === true })
  })

  handle('desktop:get-local-server-port', () => localServerPort)

  const media = desktopMediaCache(
    app.getPath('userData'),
    (digest, limit) => getContentLibrary().installedMedia(digest, limit),
    (digest, limit) => getContentLibrary().hasInstalledMedia(digest, limit),
  )
  function registerMedia<Args extends unknown[]>(
    operation: keyof typeof media,
    run: (scope: string, ...args: Args) => unknown,
  ) {
    handle('desktop:media-' + operation, (_event, scope: string, ...args: Args) => run(scope, ...args))
    ipcMain.handle('remote-play:media-' + operation, (event, scope: unknown, ...args) => {
      const { backendOrigin } = remotePlay.getBootConfig(event)
      if (typeof scope !== 'string' || scope.length > 4096) throw new Error('环境缓存标识无效')
      return run(JSON.stringify(['remote', backendOrigin, scope]), ...(args as Args))
    })
  }
  registerMedia('has', media.has)
  registerMedia('read', media.read)
  registerMedia('write', media.write)
  registerMedia('clear', media.clear)
  registerMedia('usage', media.usage)

  handle('desktop:get-app-version', () => app.getVersion())
  handle('desktop:check-for-updates', async () => checkForUpdates())
  handle('desktop:download-update', async () => {
    if (!app.isPackaged) throw new Error('仅在打包版本支持自动更新')
    await autoUpdater.downloadUpdate()
  })
  handle('desktop:download-and-install-update', async () => downloadAndInstallUpdate())

  handle('desktop:show-item-in-folder', async (_event, input: { path?: unknown }) => {
    const dirPath = typeof input?.path === 'string' ? input.path : ''
    if (!dirPath) throw new Error('path required')
    shell.showItemInFolder(dirPath)
  })

  handle('desktop:relaunch', async () => {
    relaunchAfterQuit = true
    app.quit()
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

  guardTeamDrafts(mainWindow)
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

let stoppingForQuit: Promise<void> | undefined
let stoppedForQuit = false
let relaunchAfterQuit = false
app.on('before-quit', event => {
  if (stoppedForQuit) return
  event.preventDefault()
  if (!stoppingForQuit && [...windowsWithTeamDrafts].some(window => !confirmDraftExit(window))) {
    relaunchAfterQuit = false
    return
  }
  stoppingForQuit ??= (async () => {
    if (!(await remotePlay.prepareQuit())) {
      relaunchAfterQuit = false
      stoppingForQuit = undefined
      return
    }
    const playerLibrary = playerLibraryBridge
    playerLibraryBridge = undefined
    if (playerLibrary) await stopForQuit([() => playerLibrary.close()], { timeoutMs: 3000 })
    if (stopAutomaticContentUpdates) await stopForQuit([stopAutomaticContentUpdates], { timeoutMs: 3000 })
    await stopForQuit(
      [
        () => swfHost.dispose(),
        () => remotePlay.destroy(),
        async () => {
          if (personalProfile) await (await personalProfile).storage.close()
        },
        () => localContentSessions?.close(),
        () => localEnvironments?.close(),
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
    if (relaunchAfterQuit) app.relaunch()
    app.quit()
  })()
})

app
  .whenReady()
  .then(async () => {
    if (process.platform === 'darwin') {
      if (!app.isPackaged) app.dock!.setIcon(appIconPath)
    } else {
      app.on('browser-window-created', (_event, window) => window.setIcon(appIconPath))
    }
    if (!devServerUrl) registerClientProtocol(session.defaultSession, rendererDistDir)
    autoUpdater.disableDifferentialDownload = false
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true

    await getContentLibrary().resume()
    const workspace = await getManagementWorkspaceOwner().ready()
    updateOfficialContent = createOfficialContentUpdater(getContentLibrary(), () =>
      synchronizeDesktopEnvironments(workspace, true),
    )
    await getLocalEnvironments().ready()
    const port = await startLocalServer()
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
    try {
      playerLibraryBridge = await registerPlayerLibrary({
        port,
        profile: app.getPath('userData'),
        label: app.getName() + ' · ' + app.getPath('userData'),
        serverController: localServerController,
        library: getContentLibrary(),
        environments: getLocalEnvironments(),
      })
    } catch (error) {
      const problem = error as DesktopError
      console.warn('Player library CLI connection unavailable:', problem.code ?? problem.message)
    }
    if (app.isPackaged) {
      const { startAutomaticContentUpdates } = await loadPackageUpdates()
      stopAutomaticContentUpdates = startAutomaticContentUpdates(updateOfficialContent, error =>
        console.warn('Automatic official content update failed', error),
      )
    }
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow()
        void getContentLibrary()
          .resume()
          .catch(() => {})
      }
    })
    void getContentLibrary()
      .resume()
      .catch(() => {})
  })
  .catch(error => {
    console.error('Electron startup failed:', error)
    app.quit()
  })
