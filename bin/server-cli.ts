import 'dotenv/config'
import { Command, CommanderError, InvalidArgumentError } from 'commander'
import nodemailer from 'nodemailer'
import { SQLAccountDirectory, type DurableStorage } from '@arcadia-eternity/database'
import { stageCatalogProject } from '@arcadia-eternity/pack-loader/node'
import { resolvePackPathFromRef } from '@arcadia-eternity/battle/pack'
import { ContentWorkspace } from '@arcadia-eternity/content-dev/management-workspace'
import { ManagedProjects, type ManagedProjectsOptions } from '@arcadia-eternity/content-dev/managed-projects'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { openServerStorage, workspaceRetentions } from './server-persistence'
import { createDesktopWorkspaceProxy } from './desktop-workspace-proxy'
import { createOnlineServerBackup } from './server-backup'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { attachDesktopContentControl } from './desktop-content-control'
import { initializeHostEnvironment } from './host-environment-initialize'
import { parseDesktopLaunch, saveDesktopLaunch } from './desktop-launch'
import {
  createSingleProcessApp,
  parseBattleCapacityEnv,
  EmailCodeVerifier,
  GithubAppVerifier,
  getPersistedServerSettings,
  type G3AccountServices,
} from '@arcadia-eternity/server'

async function withShippedEnvironmentProject<T>(initialize: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'arcadia-default-environment-'))
  try {
    const project = await stageCatalogProject(directory, dirname(await resolvePackPathFromRef('builtin:base')))
    return await initialize(project)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function portNumber(value: string): number {
  const port = Number(value)
  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 0 || port > 65535)
    throw new InvalidArgumentError('Port must be an integer between 0 and 65535')
  return port
}

export async function runServerCli(args: string[]): Promise<number> {
  if (args[0] === 'backup') {
    const { runServerBackupCli } = await import('./server-backup-cli')
    return runServerBackupCli(args.slice(1))
  }
  if (args[0] === 'db' || args[0] === 'admin') {
    const { runServerAdminCli } = await import('./server-admin-cli')
    return runServerAdminCli(args)
  }
  let storage: DurableStorage | undefined
  let workspace: ContentWorkspace | undefined
  let projects: ManagedProjects | undefined
  let mailer: ReturnType<typeof nodemailer.createTransport> | undefined
  let server: ReturnType<typeof createSingleProcessApp> | undefined
  const program = new Command('arcadia server')
    .description('Single-process battle server. Rooms and sessions expire when this process stops.')
    .exitOverride()
    .option('-p, --port <number>', 'HTTP and Socket.IO port', portNumber, portNumber(process.env.PORT || '8102'))
    .option('--host <address>', 'Listen address', process.env.HOST || '0.0.0.0')
    .option('--server-id <id>', 'Stable identity (generated once when omitted)', process.env.SERVER_ID)
    .option('--data-dir <directory>', 'Persistent server data directory', process.env.ARCADIA_DATA_DIR)
    .option('--workspace-root <directory>', 'Content workspace root', process.env.ARCADIA_WORKSPACE_ROOT)
    .option('--desktop-project <directory>', 'Trusted desktop host initial content project')
    .option('--desktop-managed-network', 'Trusted desktop owner controls persistent listener settings')
    .option('--desktop-origin <origin>', 'Trusted desktop renderer origin')
    .option('--desktop-launch <json>', 'Private desktop launch settings')
    .option(
      '--content-sources <file>',
      'Host-registered Git/URL/archive/package sources JSON',
      process.env.ARCADIA_CONTENT_SOURCES,
    )
    .option('--npm-registry <url>', 'HTTPS package registry for managed environments', process.env.ARCADIA_NPM_REGISTRY)
    .option(
      '--offline-content',
      'Prepare content using existing local artifacts/cache only',
      process.env.ARCADIA_OFFLINE_CONTENT === '1',
    )
    .option(
      '--allow-third-party-content',
      'Permit acquiring third-party prepared content (does not grant server execution)',
      process.env.ARCADIA_ALLOW_THIRD_PARTY_CONTENT === '1',
    )
    .option(
      '--allow-third-party-execution',
      'Community host: explicitly permit approved third-party environments',
      process.env.ARCADIA_ALLOW_THIRD_PARTY_EXECUTION === '1',
    )
    .option('--headless', 'Serve API and Socket.IO without the paired website', process.env.ARCADIA_HEADLESS === '1')
    .option('--web-root <directory>', 'Paired website build directory', process.env.ARCADIA_WEB_ROOT)
    .option(
      '--web-auto-connect <boolean>',
      'Default automatic connection for paired website visitors',
      process.env.ARCADIA_WEB_AUTO_CONNECT ?? 'true',
    )
    .option('--public-origin <origin>', 'Externally visible paired site origin', process.env.PUBLIC_ORIGIN)
    .option('--npm-project <directories...>', 'Prepare approved npm installations for room selection')
    .option('--development-project <directory>', 'Enable local authoring of one configured project')
    .option('--cors-origin <origins>', 'Allowed browser origins, separated by commas', process.env.CORS_ORIGIN || '')
  try {
    await program.parseAsync(args, { from: 'user' })
    const options = program.opts<{
      port: number
      host: string
      serverId?: string
      dataDir?: string
      workspaceRoot?: string
      desktopProject?: string
      desktopManagedNetwork?: boolean
      desktopOrigin?: string
      desktopLaunch?: string
      contentSources?: string
      npmRegistry?: string
      offlineContent?: boolean
      allowThirdPartyExecution?: boolean
      allowThirdPartyContent?: boolean
      corsOrigin: string
      headless: boolean
      webRoot?: string
      webAutoConnect: string
      publicOrigin?: string
      npmProject?: string[]
      developmentProject?: string
    }>()
    if (!['true', 'false'].includes(options.webAutoConnect))
      throw new InvalidArgumentError('--web-auto-connect / ARCADIA_WEB_AUTO_CONNECT must be true or false')
    const corsOrigins = options.corsOrigin
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
    const developmentToken = options.developmentProject ? process.env.ARCADIA_DEVELOPMENT_TOKEN : undefined
    if (
      options.developmentProject &&
      (!developmentToken || developmentToken.length < 32 || developmentToken.length > 256)
    )
      throw new Error('ARCADIA_DEVELOPMENT_TOKEN must contain 32–256 characters for the local development service')
    const accountMode = process.env.ACCOUNT_MODE
    if (accountMode && accountMode !== 'guest' && accountMode !== 'g3')
      throw new Error('ACCOUNT_MODE must be guest or g3')
    const accountKeys = [
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_FROM',
      'SMTP_USER',
      'SMTP_PASSWORD',
      'GITHUB_APP_CLIENT_ID',
      'GITHUB_APP_CLIENT_SECRET',
      'GITHUB_APP_REDIRECT_URIS',
      'GITHUB_APP_REDIRECT_URI',
      'OIDC_ISSUER',
      'OIDC_CLIENT_ID',
      'OIDC_CLIENT_SECRET',
      'OIDC_CLIENT_AUTH_METHOD',
      'OIDC_REDIRECT_URI',
    ]
    const hasAccountConfig = accountKeys.some(key => !!process.env[key])
    if (accountMode === 'guest' && hasAccountConfig)
      throw new Error('ACCOUNT_MODE=guest cannot be combined with account provider configuration')
    if (accountMode !== 'g3' && hasAccountConfig)
      throw new Error('Set ACCOUNT_MODE=g3 when configuring durable accounts')
    const desktopControl = process.connected && process.env.ARCADIA_DESKTOP_CONTROL === '1'
    if (
      (options.desktopProject || options.desktopManagedNetwork || options.desktopOrigin || options.desktopLaunch) &&
      !desktopControl
    )
      throw new Error('Desktop options require the private desktop host')
    if (!desktopControl && (options.npmProject?.length ?? 0) > 1)
      throw new Error(
        'Only one --npm-project can initialize a persistent server; publish additional environments through management',
      )
    if (options.desktopManagedNetwork) {
      if (!options.desktopOrigin) throw new Error('Managed desktop host requires its renderer origin')
      if (program.getOptionValueSource('host') !== 'cli' && !process.env.HOST) options.host = '127.0.0.1'
      if (program.getOptionValueSource('port') !== 'cli' && !process.env.PORT) options.port = 0
      if (program.getOptionValueSource('corsOrigin') !== 'cli' && !process.env.CORS_ORIGIN)
        corsOrigins.splice(0, corsOrigins.length, options.desktopOrigin)
    }
    const desktopLaunch = options.desktopLaunch ? parseDesktopLaunch(options.desktopLaunch) : undefined
    if (desktopLaunch && !options.desktopManagedNetwork)
      throw new Error('Launch settings require managed desktop hosting')
    const opened = await openServerStorage(options)
    storage = opened.storage
    const serverId = opened.serverId!
    options.serverId = serverId
    const persistedSettings = await getPersistedServerSettings(storage, options.serverId, {
      desktopLocal: desktopControl && !options.desktopManagedNetwork,
    })
    const fromDeployment = (option: string, variable: string) =>
      program.getOptionValueSource(option) === 'cli' || process.env[variable] !== undefined
    if (persistedSettings) {
      if (!fromDeployment('host', 'HOST')) options.host = persistedSettings.host
      if (!fromDeployment('port', 'PORT')) options.port = persistedSettings.port
      if (!fromDeployment('publicOrigin', 'PUBLIC_ORIGIN')) options.publicOrigin = persistedSettings.publicOrigin
      if (!fromDeployment('corsOrigin', 'CORS_ORIGIN'))
        corsOrigins.splice(0, corsOrigins.length, ...persistedSettings.corsOrigins)
    }
    if (desktopLaunch) {
      options.host = desktopLaunch.host
      options.port = desktopLaunch.port
      options.publicOrigin = desktopLaunch.publicOrigin ?? undefined
    }
    if (options.desktopOrigin && !corsOrigins.includes(options.desktopOrigin)) corsOrigins.push(options.desktopOrigin)
    const capacityEnvironment = { ...process.env }
    const capacityVariables = {
      ARCADIA_MAX_CONCURRENT_BATTLES: 'maxConcurrentBattles',
      ARCADIA_MAX_IDLE_WORKERS: 'maxIdleWorkers',
      ARCADIA_MAX_QUEUED_BATTLES: 'maxQueuedBattles',
      ARCADIA_BATTLE_QUEUE_TIMEOUT_MS: 'battleQueueTimeoutMs',
    } as const
    for (const [variable, field] of Object.entries(capacityVariables)) {
      if (capacityEnvironment[variable] === undefined && persistedSettings)
        capacityEnvironment[variable] = String(persistedSettings.battleCapacity[field])
    }
    const battleCapacity = parseBattleCapacityEnv(capacityEnvironment)
    let accounts: G3AccountServices | undefined
    if (accountMode === 'g3') {
      if (corsOrigins.includes('*')) throw new Error('G3 accounts require explicit CORS origins')
      const required = (key: string) => {
        const value = process.env[key]?.trim()
        if (!value) throw new Error(`${key} is required for G3 accounts`)
        return value
      }
      const smtpHost = required('SMTP_HOST')
      const smtpFrom = required('SMTP_FROM')
      if (accountKeys.some(key => key.startsWith('OIDC_') && !!process.env[key]))
        throw new Error('OIDC configuration is not supported in GitHub App account mode')
      const clientId = required('GITHUB_APP_CLIENT_ID')
      const clientSecret = required('GITHUB_APP_CLIENT_SECRET')
      const configuredRedirectUris = process.env.GITHUB_APP_REDIRECT_URIS?.trim()
      const legacyRedirectUri = process.env.GITHUB_APP_REDIRECT_URI?.trim()
      if (configuredRedirectUris && legacyRedirectUri)
        throw new Error('Use GITHUB_APP_REDIRECT_URIS instead of GITHUB_APP_REDIRECT_URI, not both')
      const redirectUris = (configuredRedirectUris ?? legacyRedirectUri ?? '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean)
      if (!redirectUris.length) throw new Error('GITHUB_APP_REDIRECT_URIS is required for G3 accounts')
      for (const redirectUri of redirectUris) {
        let redirectOrigin: string
        try {
          redirectOrigin = new URL(redirectUri).origin
        } catch {
          throw new Error('GITHUB_APP_REDIRECT_URIS must contain valid URLs')
        }
        if (!corsOrigins.includes(redirectOrigin))
          throw new Error('Every GITHUB_APP_REDIRECT_URIS origin must appear in CORS_ORIGIN')
      }
      const smtpPort = portNumber(process.env.SMTP_PORT ?? '587')
      if (smtpPort === 0) throw new Error('SMTP_PORT must be between 1 and 65535')
      const smtpUser = process.env.SMTP_USER
      const smtpPassword = process.env.SMTP_PASSWORD
      if (!!smtpUser !== !!smtpPassword) throw new Error('SMTP_USER and SMTP_PASSWORD must both be set or both absent')
      mailer = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        requireTLS: smtpPort !== 465,
        ...(smtpUser && smtpPassword ? { auth: { user: smtpUser, pass: smtpPassword } } : {}),
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 10_000,
      })
      const smtp = mailer
      const email = new EmailCodeVerifier({
        sendCode: async (address, code) => {
          await smtp.sendMail({
            from: smtpFrom,
            to: address,
            subject: 'Arcadia Eternity sign-in code',
            text: `Your Arcadia Eternity sign-in code is ${code}. It expires in 10 minutes.`,
          })
        },
      })
      const github = new GithubAppVerifier({
        clientId,
        clientSecret,
        redirectUris,
      })
      accounts = {
        directory: new SQLAccountDirectory(storage, options.serverId),
        email,
        github,
        ready: async () => {
          await email.ready()
          await storage!.checkSchema()
          await smtp.verify()
        },
      }
    }
    if (options.headless && options.webRoot) throw new Error('--headless cannot be combined with --web-root')
    const { persistentServerConfig } = await import('./server-config')
    const config = persistentServerConfig(options)
    const retentions = workspaceRetentions(storage, () => workspace!.workspaceId)
    workspace = desktopControl
      ? await createDesktopWorkspaceProxy({ retentions })
      : await ContentWorkspace.open(config.workspaceRoot, { retentions })
    if (!desktopControl) {
      let sources: ManagedProjectsOptions['sources']
      if (options.contentSources) {
        const sourceFile = await stat(options.contentSources)
        if (!sourceFile.isFile() || sourceFile.size > 2 * 1024 * 1024)
          throw new Error('Content source registry must be a JSON file no larger than 2 MiB')
        const value: unknown = JSON.parse(await readFile(options.contentSources, 'utf8'))
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw new Error('Invalid content source registry')
        sources = value as ManagedProjectsOptions['sources']
      }
      projects = new ManagedProjects(join(config.dataDirectory, 'projects'), {
        allowThirdPartyContent: options.allowThirdPartyContent || options.allowThirdPartyExecution,
        registry: options.npmRegistry,
        offline: options.offlineContent,
        npmUserConfig: process.env.ARCADIA_NPM_USERCONFIG,
        sources,
      })
    }
    const webRoot =
      options.headless || (desktopControl && (!options.desktopManagedNetwork || !options.webRoot))
        ? undefined
        : resolve(options.webRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), 'web'))
    if (options.publicOrigin && !corsOrigins.includes(options.publicOrigin)) corsOrigins.push(options.publicOrigin)
    server = createSingleProcessApp({
      ...battleCapacity,
      webRoot,
      webAutoConnect: options.webAutoConnect === 'true',
      desktopLocal: desktopControl && options.host === '127.0.0.1' && !webRoot,
      desktopManaged: desktopControl && options.desktopManagedNetwork,
      desktopRendererOrigin: desktopControl ? options.desktopOrigin : undefined,
      publicOrigin: options.publicOrigin,
      port: options.port,
      host: options.host,
      serverId: options.serverId,
      corsOrigins:
        !persistedSettings && !options.desktopOrigin && !fromDeployment('corsOrigin', 'CORS_ORIGIN')
          ? undefined
          : corsOrigins,
      accounts,
      management: {
        storage,
        workspace,
        createServerBackup: signal =>
          createOnlineServerBackup({ storage: storage!, workspace: workspace!, serverId, signal }),
        transferDirectory: join(config.dataDirectory, 'transfers'),
        trustedProxyAddresses: process.env.MANAGEMENT_TRUSTED_PROXY_IPS?.split(',')
          .map(value => value.trim())
          .filter(Boolean),
        allowThirdPartyExecution: desktopControl || options.allowThirdPartyExecution,
        initialization: desktopControl
          ? options.desktopProject
            ? { kind: 'desktop', environmentId: 'desktop-host' }
            : undefined
          : options.npmProject?.[0]
            ? { kind: 'npm', environmentId: 'startup-npm' }
            : { kind: 'builtin', environmentId: 'builtin-server' },
        ...(projects
          ? { prepareEnvironment: (input, validator) => projects!.prepareVersion(workspace!, input, validator) }
          : {}),
      },
      ...(options.developmentProject
        ? { development: { directory: resolve(options.developmentProject), token: developmentToken! } }
        : {}),
    })
    await server.environments.ready()
    const builtinId = server.environments.descriptor().id
    if (desktopControl && ((!options.desktopManagedNetwork && options.host !== '127.0.0.1') || accounts))
      throw new Error('Invalid desktop host')
    if (desktopControl && options.desktopProject) {
      const { initializeDesktopHost } = await import('./desktop-host-initialize')
      const initialize = (projectDirectory: string) =>
        initializeDesktopHost({ management: server!.management!, workspace: workspace!, projectDirectory })
      if (options.npmProject?.[0]) await initialize(options.desktopProject)
      else await withShippedEnvironmentProject(initialize)
    } else if (!desktopControl && options.npmProject?.[0]) {
      await initializeHostEnvironment({
        management: server.management!,
        workspace,
        projectDirectory: options.npmProject[0],
        kind: 'npm',
        environmentId: 'startup-npm',
        name: '启动时批准的 npm 环境',
        matchmakingEnabled: true,
      })
    } else if (!desktopControl) {
      await withShippedEnvironmentProject(projectDirectory =>
        initializeHostEnvironment({
          management: server!.management!,
          workspace: workspace!,
          projectDirectory,
          kind: 'builtin',
          environmentId: 'builtin-server',
          name: '内置服务器环境',
          matchmakingEnabled: true,
        }),
      )
    }
    if (desktopLaunch) await saveDesktopLaunch(server.management!, desktopLaunch)
    await server.start()
    const detachDesktopControl = desktopControl
      ? attachDesktopContentControl(server.environments, builtinId, request =>
          server!.management!.localRequest(request),
        )
      : undefined
    const runningServer = server
    let closing = false
    const stop = () => {
      if (closing) return
      closing = true
      detachDesktopControl?.()
      console.log('Stopping server; all rooms and sessions are being discarded.')
      void runningServer
        .stop()
        .catch(error => {
          console.error(error instanceof Error ? error.message : error)
          process.exitCode = 1
        })
        .finally(async () => {
          mailer?.close()
          await workspace?.close()
          await projects?.close()
          await storage?.close()
          process.removeListener('SIGINT', stop)
          process.removeListener('SIGTERM', stop)
        })
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    const address = server.httpServer.address()
    if (desktopControl && options.desktopManagedNetwork && typeof address === 'object' && address) {
      process.send?.({
        type: 'arcadia.desktop.listener',
        serverId: options.serverId,
        host: address.address,
        port: address.port,
        publicOrigin: options.publicOrigin,
      })
    }
    console.log(
      `Battle server ${options.serverId} listening on port ${typeof address === 'object' ? address?.port : options.port}`,
    )
    console.log('Rooms and sessions are held in memory. Restarting abandons all rooms.')
    return 0
  } catch (error) {
    await server?.stop()
    mailer?.close()
    await workspace?.close()
    await projects?.close()
    await storage?.close()
    if (error instanceof CommanderError && error.exitCode === 0) return 0
    console.error(error instanceof Error ? error.message : error)
    return 1
  }
}
