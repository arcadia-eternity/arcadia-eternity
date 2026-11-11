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
import { prepareContentPack } from './testing.ts'
import { PreviewAutomation } from './preview-control.ts'
import { AuthorWorkspace } from './workspace.ts'
import { ProjectTeams } from './project-teams.ts'

/** A captured npm candidate, with each battle in a dedicated Worker and each package in Arena.
 * The existing client consumes public metadata and IBattleSystem messages.
 */
export async function startPreview(root: string, { clientUrl, signal, ...environmentOptions }: any = {}) {
  const prepared: any = await prepareContentPack(root, environmentOptions)
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
  let endpoint,
    system,
    unsubscribe,
    detachTimers = [],
    closed = false,
    closing
  let events = [],
    sequence = 0
  const methods = new Set([
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
  ])
  const assets = new Map()
  const content: any = buildDisplayCatalog(prepared.environment.data, [], prepared.environment.presentation)
  for (const pkg of prepared.environment.presentation)
    for (const asset of pkg.resources) assets.set(`${pkg.namespace}/${asset.id}`, asset)
  content.locales = buildDisplayLocales(prepared.environment.presentation, {}, content)
  function resource(owner, reference) {
    const namespace = typeof reference === 'object' ? reference.namespace : owner
    const id = typeof reference === 'object' ? reference.id : reference
    const pkg = prepared.environment.presentation.find(
      item => item.namespace === namespace || (!item.namespace && item.projectId === namespace),
    )
    const asset = pkg?.manifest.resources.find(item => item.id === id)
    if (!asset) throw new Error(`RESOURCE_REFERENCE: ${namespace}/${id}`)
    return asset.kind === 'http' ? asset.source : `${endpoint}/assets/${encodeURIComponent(`${pkg.namespace}/${id}`)}`
  }
  let displayCatalog
  function publicContent() {
    if (displayCatalog) return displayCatalog
    const result = structuredClone(content)
    for (const kind of ['species', 'skills', 'marks'])
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
      if (!error.message.startsWith('TEAM_MISSING:')) throw error
      const ids = Object.keys(prepared.teamVersions)
      const players = ids.length
        ? prepared.loadTeams([ids[0], ids[1] ?? ids[0]])
        : [0, 1].map(side => ({ id: String(side).repeat(21), name: side === 0 ? '我方' : '对方', team: [] }))
      return {
        players,
        warning: `默认队伍 ${error.message.slice('TEAM_MISSING:'.length).trim()} 已不存在。请从项目库选择队伍；自动测试仍按项目配置检查默认队伍。`,
      }
    }
  }
  async function reset(players: any = undefined, options: any = {}) {
    // Validate and construct first: a bad test team must not destroy the current match.
    const nextSystem = await prepared.createBattleSession(options.rngSeed ?? 'author-preview', {
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
      message => {
        events.push({ cursor: ++sequence, message })
        // A bounded stream fails explicitly if a client falls behind; it never skips deltas.
        if (events.length > 4096) events.shift()
      },
      { viewerId: initial.players[0].id, showHidden: false },
    )
    detachTimers = [
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
    ].map(type =>
      system.onTimerEvent(type, data => {
        events.push({ cursor: ++sequence, timer: { type, data } })
        if (events.length > 4096) events.shift()
      }),
    )
    return system.getState(undefined, true)
  }
  const server = createServer(async (request, response) => {
    const json = (status, value) => {
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
      const url = new URL(request.url, endpoint)
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
      const { args = [] } = input
      if (!Array.isArray(args)) throw new Error('INVALID_ARGUMENTS')
      if (route === 'configure') {
        if (!Array.isArray(args[0]) || args[0].length !== 2) throw new Error('请配置双方测试队伍')
        return json(200, { result: await reset(args[0], args[1]) })
      }
      if (route === 'open') {
        const state = system ? await system.getState(undefined, true) : await reset()
        const outcome = events.findLast(event => event.message?.type === 'BATTLE_END')?.message.data
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
      return json(200, { result: (await system[route](...args)) ?? null })
    } catch (error) {
      json(error.code === 'BATTLE_REVISION_CONFLICT' ? 409 : 400, {
        error: error.message,
        ...(error.code ? { code: error.code } : {}),
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
    endpoint = `http://127.0.0.1:${(server.address() as any).port}/${token}`
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

async function readSourceMappings(root) {
  try {
    return JSON.parse(await readFile(join(root, '.arcadia/debug-sources.json'), 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return {}
    throw error
  }
}
