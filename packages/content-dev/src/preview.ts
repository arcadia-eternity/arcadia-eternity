import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createServer } from 'node:http'
import { randomBytes, createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { setGlobalLogger } from '@arcadia-eternity/battle/engine'
import {
  buildDisplayCatalog,
  buildDisplayLocales,
  mapPresentationResources,
} from '@arcadia-eternity/pack-loader/native'
import type { PreparedPresentation } from '@arcadia-eternity/pack-loader/node'
import type { BattleMessage, BattleState, Events } from '@arcadia-eternity/const'
import type { ResourceReference } from '@arcadia-eternity/schema'
import { prepareContentPack } from './testing.ts'
import { PreviewAutomation } from './preview-control.ts'
import { AuthorWorkspace } from './workspace.ts'
import { ProjectTeams } from './project-teams.ts'
import { errorCode, errorMessage, isRecord } from './types.ts'

type PreviewPrepared = Awaited<ReturnType<typeof prepareContentPack>>
type PreviewSystem = Awaited<ReturnType<PreviewPrepared['createBattleSession']>>
type PreviewOptions = NonNullable<Parameters<typeof prepareContentPack>[1]>
interface StartPreviewOptions extends PreviewOptions {
  clientUrl?: string
  signal?: AbortSignal
}
type PreviewEvent = {
  cursor: number
  message?: BattleMessage
  timer?: { type: keyof Events; data: Events[keyof Events] }
}
type DisplayCatalog = ReturnType<typeof buildDisplayCatalog> & {
  locales: ReturnType<typeof buildDisplayLocales>
}
type BattleOptions = NonNullable<NonNullable<Parameters<PreviewPrepared['createBattleSession']>[1]>['battleOptions']>

/** A captured npm candidate, with each battle in a dedicated Worker and each package in Arena.
 * The existing client consumes public metadata and IBattleSystem messages.
 */
export async function startPreview(
  root: string,
  { clientUrl, signal, ...environmentOptions }: StartPreviewOptions = {},
) {
  const prepared = await prepareContentPack(root, environmentOptions)
  const automation = new PreviewAutomation(prepared, {
    async readTeams() {
      // Candidate rules stay fixed; every new automated battle uses saved teams from the source project.
      const workspace = await AuthorWorkspace.open(environmentOptions.lockRoot ?? root, { watch: false })
      try {
        return await new ProjectTeams(workspace).list()
      } finally {
        await workspace.close()
      }
    },
  })
  const token = randomBytes(24).toString('hex')
  let endpoint = '',
    system: PreviewSystem | undefined,
    unsubscribe: (() => void) | undefined,
    detachTimers: (() => void)[] = [],
    closing: Promise<void> | undefined
  let closed = false
  let events: PreviewEvent[] = [],
    sequence = 0
  const methodNames = [
    'ready',
    'getState',
    'getAvailableSelection',
    'submitAction',
    'isTimerEnabled',
    'getPlayerTimerState',
    'getAllPlayerTimerStates',
    'getTimerConfig',
    'startAnimation',
    'endAnimation',
    'createRuntimeSnapshot',
    'restoreRuntimeSnapshot',
  ] as const
  const methods = new Set<string>(methodNames)
  const assets = new Map<string, PreparedPresentation['resources'][number]>()
  const catalog = buildDisplayCatalog(prepared.environment.data, [], prepared.environment.presentation)
  for (const pkg of prepared.environment.presentation)
    for (const asset of pkg.resources) assets.set(`${pkg.namespace}/${asset.id}`, asset)
  const content: DisplayCatalog = {
    ...catalog,
    locales: buildDisplayLocales(prepared.environment.presentation, {}, catalog),
  }
  function resource(owner: string, reference: ResourceReference): ResourceReference {
    const namespace = typeof reference === 'object' ? reference.namespace : owner
    const id = typeof reference === 'object' ? reference.id : reference
    const pkg = prepared.environment.presentation.find(
      item => item.namespace === namespace || (!item.namespace && item.projectId === namespace),
    )
    const asset = pkg?.manifest.resources.find(item => item.id === id)
    if (!pkg || !asset) throw new Error(`RESOURCE_REFERENCE: ${namespace}/${id}`)
    return asset.kind === 'http' ? asset.source : `${endpoint}/assets/${encodeURIComponent(`${pkg.namespace}/${id}`)}`
  }
  let displayCatalog: DisplayCatalog | undefined
  function publicContent() {
    if (displayCatalog) return displayCatalog
    const result = structuredClone(content)
    for (const kind of ['species', 'skills', 'marks'] as const)
      for (const row of result[kind])
        if (row.presentation) {
          const namespace = row.id.includes(':') ? row.id.slice(0, row.id.indexOf(':')) : ''
          row.presentation = mapPresentationResources(row.presentation, ref => resource(namespace, ref))
        }
    displayCatalog = result
    return displayCatalog
  }
  function manualSetup() {
    try {
      return { players: prepared.defaultPlayers() }
    } catch (error) {
      const message = errorMessage(error)
      if (!message.startsWith('TEAM_MISSING:')) throw error
      const ids = Object.keys(prepared.teamVersions)
      const players = ids.length
        ? prepared.loadTeams([ids[0], ids[1] ?? ids[0]])
        : [0, 1].map(side => ({ id: String(side).repeat(21), name: side === 0 ? '我方' : '对方', team: [] }))
      return {
        players,
        warning: `默认队伍 ${message.slice('TEAM_MISSING:'.length).trim()} 已不存在。请从项目库选择队伍；自动测试仍按项目配置检查默认队伍。`,
      }
    }
  }
  async function reset(
    players: NonNullable<Parameters<PreviewPrepared['createBattleSession']>[1]>['players'] = undefined,
    options: BattleOptions = {},
  ): Promise<BattleState> {
    // Validate and construct first: a bad test team must not destroy the current match.
    const seed = typeof options.rngSeed === 'string' ? options.rngSeed : 'author-preview'
    const nextSystem = await prepared.createBattleSession(seed, {
      ai: true,
      players: players ?? manualSetup().players,
      runtimeIds: true,
      battleOptions: options,
    })
    unsubscribe?.()
    detachTimers.forEach(detach => detach())
    detachTimers = []
    try {
      await system?.cleanup()
    } catch (error) {
      await nextSystem.cleanup()
      throw error
    }
    events = []
    sequence = 0
    system = nextSystem
    const initial = await system.getState(undefined, true)
    unsubscribe = system.BattleEvent(
      (message: BattleMessage) => {
        events.push({ cursor: ++sequence, message })
        // A bounded stream fails explicitly if a client falls behind; it never skips deltas.
        if (events.length > 4096) events.shift()
      },
      { viewerId: initial.players[0].id, showHidden: false },
    )
    const timerTypes = [
      'timerStart',
      'timerUpdate',
      'timerPause',
      'timerResume',
      'timerTimeout',
      'teamSelectionTimerStart',
      'teamSelectionTimerStop',
      'teamSelectionTimeout',
      'timerSnapshot',
      'timerStateChange',
      'animationStart',
      'animationEnd',
    ] as const
    detachTimers = timerTypes.map(type =>
      system!.onTimerEvent(type, data => {
        events.push({ cursor: ++sequence, timer: { type, data } })
        if (events.length > 4096) events.shift()
      }),
    )
    return system.getState(undefined, true)
  }
  const server = createServer(async (request, response) => {
    const json = (status: number, value: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(value))
    }
    response.setHeader('cache-control', 'no-store')
    response.setHeader('access-control-allow-origin', '*')
    response.setHeader('access-control-allow-headers', 'content-type')
    response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
    response.setHeader('access-control-allow-private-network', 'true')
    response.setHeader('referrer-policy', 'no-referrer')
    try {
      const url = new URL(request.url ?? '/', endpoint || 'http://127.0.0.1')
      if (!url.pathname.startsWith(`/${token}/`)) return json(403, { error: 'PREVIEW_UNAUTHORIZED' })
      if (request.method === 'OPTIONS') {
        response.writeHead(204)
        response.end()
        return
      }
      const route = url.pathname.slice(token.length + 2)
      if (request.method === 'GET' && route === 'content')
        return json(200, {
          content: publicContent(),
          candidate: prepared.candidate,
          teams: prepared.teams,
          draftKey: createHash('sha256')
            .update(resolve(environmentOptions.lockRoot ?? root))
            .digest('hex'),
          ...manualSetup(),
          active: !!system,
        })
      if (request.method === 'GET' && route === 'events') {
        const after = Number(url.searchParams.get('after'))
        if (!Number.isSafeInteger(after) || after < 0 || after < (events[0]?.cursor ?? 1) - 1)
          return json(409, { error: 'PREVIEW_EVENTS_EXPIRED' })
        return json(200, { events: events.filter(event => event.cursor > after), cursor: sequence })
      }
      if (request.method === 'GET' && route.startsWith('assets/')) {
        const asset = assets.get(decodeURIComponent(route.slice(7)))
        if (!asset) return json(404, { error: 'RESOURCE_NOT_FOUND' })
        response.writeHead(200, { 'content-type': asset.mime ?? 'application/octet-stream' })
        createReadStream(asset.file)
          .on('error', () => response.destroy())
          .pipe(response)
        return
      }
      if (request.method !== 'POST') return json(404, { error: 'NOT_FOUND' })
      let body = ''
      for await (const chunk of request) {
        body += chunk
        if (Buffer.byteLength(body) > 2 * 1024 * 1024) return json(413, { error: 'REQUEST_TOO_LARGE' })
      }
      const input = JSON.parse(body || '{}')
      if (route.startsWith('automation/'))
        return json(200, { result: await automation.call(route.slice('automation/'.length), input) })
      const { args = [] } = input as { args?: unknown[] }
      if (!Array.isArray(args)) throw new Error('INVALID_ARGUMENTS')
      if (route === 'configure') {
        if (!Array.isArray(args[0]) || args[0].length !== 2) throw new Error('请配置双方测试队伍')
        if (args[1] !== undefined && !isRecord(args[1])) throw new Error('INVALID_OPTIONS')
        return json(200, { result: await reset(args[0], args[1]) })
      }
      if (route === 'open') {
        const state = system ? await system.getState(undefined, true) : await reset()
        const outcome = events.findLast(event => event.message?.type === 'BATTLE_END')?.message?.data
        return json(200, { result: { state, cursor: sequence, outcome } })
      }
      if (route === 'cleanup') {
        unsubscribe?.()
        detachTimers.forEach(detach => detach())
        detachTimers = []
        await system?.cleanup()
        system = undefined
        return json(200, { result: null })
      }
      if (!methods.has(route) || !system) return json(400, { error: 'PREVIEW_NOT_ACTIVE' })
      const method = system[route as keyof PreviewSystem]
      if (typeof method !== 'function') return json(400, { error: 'PREVIEW_NOT_ACTIVE' })
      return json(200, {
        result: (await (method as (...parameters: unknown[]) => Promise<unknown>).apply(system, args)) ?? null,
      })
    } catch (error) {
      const code = errorCode(error)
      json(code === 'BATTLE_REVISION_CONFLICT' ? 409 : 400, {
        error: errorMessage(error),
        ...(code ? { code } : {}),
      })
    }
  })
  async function close() {
    closing ??= (async () => {
      closed = true
      signal?.removeEventListener('abort', close)
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
      unsubscribe?.()
      detachTimers.forEach(detach => detach())
      await system?.cleanup()
      await automation.close()
      await prepared.dispose()
    })()
    return closing
  }
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('PREVIEW_ADDRESS_INVALID')
    endpoint = `http://127.0.0.1:${address.port}/${token}`
    signal?.addEventListener('abort', close, { once: true })
    if (signal?.aborted) {
      await close()
      throw new Error('PREVIEW_CANCELLED')
    }
    const clientPath = `/content/preview?endpoint=${encodeURIComponent(endpoint)}`
    return {
      endpoint,
      clientPath,
      candidate: prepared.candidate,
      environmentLock: prepared.environmentLock,
      sourceRevisions: prepared.sourceRevisions,
      ...(clientUrl ? { url: new URL(clientPath, clientUrl).href } : {}),
      close,
      get closed() {
        return closed
      },
    }
  } catch (error) {
    await close()
    throw error
  }
}

export async function previewCommand() {
  setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} })
  const controller = new AbortController()
  const stop = () => controller.abort()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  process.once('disconnect', stop)
  try {
    const preview = await startPreview(process.cwd(), {
      clientUrl: process.env.ARCADIA_PREVIEW_CLIENT_URL,
      signal: controller.signal,
      environmentId: process.env.ARCADIA_DEBUG_ENVIRONMENT ?? 'default',
      offline: !process.env.ARCADIA_DEBUG_ENVIRONMENT || process.env.ARCADIA_DEBUG_ENVIRONMENT === 'default',
      lockRoot: process.env.ARCADIA_DEBUG_ROOT,
      sources: process.env.ARCADIA_DEBUG_ROOT ? await readSourceMappings(process.env.ARCADIA_DEBUG_ROOT) : {},
    })
    const { endpoint, clientPath, candidate, environmentLock, sourceRevisions, url } = preview
    console.log(
      `ARCADIA_RESULT=${JSON.stringify({ preview: { endpoint, clientPath, url }, candidate, environmentLock, sourceRevisions })}`,
    )
    if (!controller.signal.aborted)
      await new Promise(resolve => controller.signal.addEventListener('abort', resolve, { once: true }))
    await preview.close()
  } finally {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
    process.removeListener('disconnect', stop)
  }
}

async function readSourceMappings(root: string): Promise<Record<string, string | undefined>> {
  try {
    return JSON.parse(await readFile(join(root, '.arcadia/debug-sources.json'), 'utf8')) as Record<
      string,
      string | undefined
    >
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return {}
    throw error
  }
}
