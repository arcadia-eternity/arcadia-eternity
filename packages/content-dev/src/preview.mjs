import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { LocalBattleSystemV4 } from '@arcadia-eternity/battle/v4/host'
import { setGlobalLogger } from '@arcadia-eternity/battle/v4'
import { SpeciesSchema, SkillSchema, MarkSchema, parseWithErrors } from '@arcadia-eternity/schema'
import { prepareContentPack } from './testing.mjs'

/** A captured npm candidate, with rules executed only in this local Node process.
 * The existing client consumes public metadata and IBattleSystem messages.
 */
export async function startPreview(root, { clientUrl, signal } = {}) {
  const prepared = await prepareContentPack(root)
  const token = randomBytes(24).toString('hex')
  let endpoint,
    system,
    unsubscribe,
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
  const content = Object.fromEntries(
    Object.entries({ species: SpeciesSchema, skills: SkillSchema, marks: MarkSchema }).map(([kind, schema]) => [
      kind,
      prepared.environment.data[kind].map(raw => ({
        ...parseWithErrors(schema, raw),
        ...(typeof raw.name === 'string' ? { name: raw.name } : {}),
        ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
      })),
    ]),
  )
  // Only public definitions cross the process boundary; never export effect bodies.
  for (const kind of ['species', 'skills', 'marks'])
    for (const record of content[kind]) {
      delete record.effect
      if (kind === 'marks') delete record.config
    }
  const bundles = {}
  for (const pkg of prepared.environment.presentation) {
    for (const asset of pkg.resources) assets.set(`${pkg.namespace}/${asset.id}`, asset)
    for (const [language, namespaces] of Object.entries(pkg.manifest.locales))
      for (const [namespace, entries] of Object.entries(namespaces)) {
        const target = ((bundles[language] ??= {})[namespace] ??= {})
        for (const [id, text] of Object.entries(entries)) target[`${pkg.namespace}:${id}`] = text
      }
  }
  content.locales = { defaultLocale: prepared.environment.presentation[0]?.manifest.defaultLocale ?? 'zh-CN', bundles }
  function resource(owner, reference) {
    const namespace = typeof reference === 'object' ? reference.namespace : owner
    const id = typeof reference === 'object' ? reference.id : reference
    const pkg = prepared.environment.presentation.find(item => item.namespace === namespace)
    const asset = pkg?.manifest.resources.find(item => item.id === id)
    if (!asset) throw new Error(`RESOURCE_REFERENCE: ${namespace}/${id}`)
    return asset.kind === 'http' ? asset.source : `${endpoint}/assets/${encodeURIComponent(`${namespace}/${id}`)}`
  }
  function publicContent() {
    const result = structuredClone(content)
    for (const pkg of prepared.environment.presentation)
      for (const binding of pkg.manifest.bindings) {
        const { id: _id, target, ...presentation } = binding
        for (const [key, ref] of Object.entries(presentation)) {
          if (key === 'battle')
            presentation.battle = {
              ...ref,
              source: resource(pkg.namespace, ref.source),
              ...(ref.fallback ? { fallback: resource(pkg.namespace, ref.fallback) } : {}),
            }
          else presentation[key] = resource(pkg.namespace, ref)
        }
        result[target.kind].find(row => row.id === `${pkg.namespace}:${target.id}`).presentation = presentation
      }
    return result
  }
  async function reset(players) {
    // Validate and construct first: a bad test team must not destroy the current match.
    const battle = prepared.createBattle('author-preview', { ai: true, players })
    unsubscribe?.()
    await system?.cleanup()
    events = []
    sequence = 0
    system = new LocalBattleSystemV4(battle, prepared.environment.content)
    unsubscribe = system.BattleEvent(
      message => {
        events.push({ cursor: ++sequence, message })
        // A bounded stream fails explicitly if a client falls behind; it never skips deltas.
        if (events.length > 4096) events.shift()
      },
      { viewerId: battle.playerA.id, showHidden: false },
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
          players: prepared.defaultPlayers(),
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
      const { args = [] } = JSON.parse(body || '{}')
      if (!Array.isArray(args)) throw new Error('INVALID_ARGUMENTS')
      if (route === 'configure') {
        if (!Array.isArray(args[0]) || args[0].length !== 2) throw new Error('请配置双方测试队伍')
        return json(200, { result: await reset(args[0]) })
      }
      if (route === 'open') {
        const state = system ? await system.getState(undefined, true) : await reset()
        const outcome = events.findLast(event => event.message.type === 'BATTLE_END')?.message.data
        return json(200, { result: { state, cursor: sequence, outcome } })
      }
      if (route === 'cleanup') {
        unsubscribe?.()
        await system?.cleanup()
        system = undefined
        return json(200, { result: null })
      }
      if (!methods.has(route) || !system) return json(400, { error: 'PREVIEW_NOT_ACTIVE' })
      return json(200, { result: (await system[route](...args)) ?? null })
    } catch (error) {
      json(400, { error: error.message })
    }
  })
  async function close() {
    closing ??= (async () => {
      closed = true
      signal?.removeEventListener('abort', close)
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
      unsubscribe?.()
      await system?.cleanup()
      await prepared.dispose()
    })()
    return closing
  }
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    endpoint = `http://127.0.0.1:${server.address().port}/${token}`
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
    })
    const { endpoint, clientPath, candidate, url } = preview
    console.log(`ARCADIA_RESULT=${JSON.stringify({ preview: { endpoint, clientPath, url }, candidate })}`)
    if (!controller.signal.aborted)
      await new Promise(resolve => controller.signal.addEventListener('abort', resolve, { once: true }))
    await preview.close()
  } finally {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
    process.removeListener('disconnect', stop)
  }
}
