import type { ContentPresentation } from '@arcadia-eternity/schema'
import { officialAssetUrl } from '@/utils/officialAssetUrl'
import { mediaKindForResource, type MediaKind } from '../../shared/media-formats.mjs'
import {
  battleUiUrl,
  mediaEnvironment,
  canPersistMedia,
  warmMedia,
  ensureMediaCached,
  type MediaCatalog,
  type MediaEnvironment,
} from './mediaLoader'
import { startMediaPreload } from './mediaPreloadProgress'
import { withPreloadBackoff } from './mediaPreloadRetry'
import { beginMediaPriority, waitForMediaPriority, type MediaPriority } from './mediaPriority'

type Asset = { url: string; kind?: MediaKind; limit?: number; label?: string }
export type MediaPet = {
  species: string
  elements?: readonly string[]
  skills?: readonly string[]
  ability?: string
  emblem?: string
  marks?: readonly string[]
}
function presentationAssets(row: { id: string; name?: string; presentation?: ContentPresentation }): Asset[] {
  const p = row.presentation
  if (!p) return []
  const assets: Asset[] = []
  const add = (url: unknown, label: string, kind: MediaKind = 'image') => {
    if (typeof url === 'string' && url)
      assets.push({ url: officialAssetUrl(url), kind, label: `${row.name || row.id} · ${label}` })
  }
  add(
    p.battle?.source,
    p.battle?.renderer === 'seer2-swf' ? 'SWF 动画' : '战斗图像',
    p.battle?.renderer === 'seer2-swf' ? 'swf' : 'image',
  )
  add(p.icon, '图标')
  add(p.battle?.fallback, '备用图像')
  add(p.portrait, '立绘')
  add(p.cry, '叫声', 'audio')
  add(p.sfx, '音效', 'audio')
  add(p.background, '背景')
  add(p.music, '音乐', 'audio')
  return assets
}

export function allEnvironmentAssets(content: MediaCatalog, environment: MediaEnvironment): Asset[] {
  const declared = environment.resources.map(row => {
    return { url: officialAssetUrl(row.source), label: row.id, kind: mediaKindForResource(row) }
  })
  const presentations = [content.species, content.skills, content.marks].flatMap(rows =>
    rows.flatMap(row => presentationAssets(row)),
  )
  return [...presentations, ...declared]
}

export async function preloadMedia(
  assets: Asset[],
  environment: MediaEnvironment,
  signal: AbortSignal,
  {
    save,
    label = save ? '缓存环境资源' : '对战资源',
    background = false,
    teamUrls,
    failedUrls,
    priority = save || background ? 'background' : 'critical',
  }: {
    save?: (completed: number, total: number, failed: number) => void
    label?: string
    background?: boolean
    teamUrls?: ReadonlySet<string>
    failedUrls?: Set<string>
    priority?: MediaPriority
  } = {},
) {
  const unique = new Map<string, Asset>()
  const typeConflicts = new Set<string>()
  for (const item of assets) {
    if (save && !canPersistMedia(environment, item.url)) continue
    const previous = unique.get(item.url)
    if (!previous) unique.set(item.url, { ...item })
    else {
      if (previous.kind && item.kind && previous.kind !== item.kind) typeConflicts.add(item.url)
      previous.kind ??= item.kind
      if (item.limit !== undefined) previous.limit = Math.min(previous.limit ?? item.limit, item.limit)
    }
  }
  const items = [...unique.values()]
  save?.(0, items.length, 0)
  if (!items.length || signal.aborted) return 0
  const batch = startMediaPreload(label, items.length, signal, save, index => failedUrls?.add(items[index]!.url))
  const endPriority = beginMediaPriority(priority)
  const waiting = background ? new Map(items.map((item, index) => [item.url, index])) : undefined
  const promoted = new Set<Promise<void>>()
  let next = 0
  function processItem(index: number, urgent = false, requested?: MediaPriority) {
    const { url, kind, limit, label } = items[index]!
    return batch.run(index, label ?? `资源 ${index + 1}`, () => {
      if (typeConflicts.has(url)) throw new Error('同一资源地址声明了不同的媒体类型')
      const options = {
        environment,
        signal,
        kind,
        maxBytes: limit,
        background,
        requireSave: !!save,
        priority: urgent ? requested : priority,
      }
      if (save || (background && !urgent)) return ensureMediaCached(url, options, teamUrls?.has(url))
      return warmMedia(url, options)
    })
  }
  // The promoted read starts the shared flight, so it carries the requesting consumer's priority.
  function promote(url: string, requested?: MediaPriority) {
    const index = waiting?.get(url)
    if (index === undefined || signal.aborted) return
    waiting!.delete(url)
    const task = processItem(index, true, requested)
    promoted.add(task)
    void task.then(() => promoted.delete(task))
  }
  async function worker() {
    while (!signal.aborted && next < items.length) {
      // A higher-priority batch takes the network between items. Promoted items do not wait.
      await waitForMediaPriority(priority, signal)
      if (signal.aborted || next >= items.length) break
      const index = next++
      if (!waiting || waiting.delete(items[index]!.url)) await processItem(index)
    }
  }
  if (waiting) environment.promote = promote
  try {
    await Promise.all(Array.from({ length: Math.min(items.length, 3) }, worker))
    await Promise.all(promoted)
  } finally {
    if (waiting && environment.promote === promote) delete environment.promote
    endPriority()
    batch.finish()
  }
  return batch.failed
}

let sceneChoices = { music: Math.random(), background: Math.random() }
export function resetBattleScene() {
  sceneChoices = { music: Math.random(), background: Math.random() }
}
export function battleScene(environment: MediaEnvironment, tag: 'music' | 'background', choice: string) {
  const rows = environment.resources.filter(row => row.tags?.includes(tag))
  const row = rows.find(row => row.id === choice) ?? rows[Math.floor(sceneChoices[tag] * rows.length)]
  return row && officialAssetUrl(row.source)
}

type PreloadSettings = { battleRenderer: string; battleMusic: string; background: string }
type TeamMedia = {
  /** Assets the battle page waits for. */
  critical: Asset[]
  /** Music, pet SWF animations, cries and skill sounds. Sprites show their static image until the movie is ready. */
  deferred: Asset[]
  /** Skill VFX are optional and are played only from memory. */
  effects: Asset[]
}
function teamMediaAssets(
  content: MediaCatalog,
  env: MediaEnvironment,
  pets: readonly MediaPet[],
  settings: PreloadSettings,
  globalMarks: readonly string[] = [],
): TeamMedia {
  const critical: Asset[] = []
  const movies: Asset[] = []
  const sounds: Asset[] = []
  const effects: Asset[] = []
  const animated = settings.battleRenderer !== 'image'
  const add = (list: Asset[], url: unknown, kind: MediaKind, label: string) => {
    if (typeof url === 'string' && url) list.push({ url: officialAssetUrl(url), kind, label })
  }
  const background = battleScene(env, 'background', settings.background)
  if (background) critical.push({ url: background, kind: 'image', label: '战斗背景' })
  const music = battleScene(env, 'music', settings.battleMusic)
  if (music) movies.push({ url: music, kind: 'audio', label: '战斗音乐' })
  const elements = [...new Set(pets.flatMap(pet => pet.elements ?? []))].flatMap(element => {
    const url = battleUiUrl('element:' + element, true, env)
    return url ? [{ url, kind: 'image' as const, label: element }] : []
  })
  critical.push(...elements)
  const bySpecies = new Map(content.species.map(row => [row.id as string, row]))
  for (const pet of pets) {
    const row = bySpecies.get(pet.species)
    const p = row?.presentation
    if (!p) continue
    const name = row.name || row.id
    add(critical, p.icon, 'image', `${name} · 图标`)
    // The battle sprite shows this image until its SWF animation is ready.
    if (p.battle?.renderer === 'image') add(critical, p.battle.source, 'image', `${name} · 战斗图像`)
    else if (p.battle?.renderer === 'seer2-swf') {
      add(critical, p.battle.fallback ?? p.portrait, 'image', `${name} · 备用图像`)
      if (animated) add(movies, p.battle.source, 'swf', `${name} · SWF 动画`)
    } else add(critical, p.portrait, 'image', `${name} · 立绘`)
    add(sounds, p.cry, 'audio', `${name} · 叫声`)
  }
  const skills = new Set(pets.flatMap(p => p.skills ?? []))
  for (const row of content.skills) {
    if (!skills.has(row.id) || !row.presentation) continue
    const name = row.name || row.id
    add(sounds, row.presentation.sfx, 'audio', `${name} · 音效`)
    if (animated) add(effects, row.presentation.vfx, 'swf', `${name} · 特效`)
  }
  const marks = new Set([...globalMarks, ...pets.flatMap(p => [p.ability, p.emblem, ...(p.marks ?? [])])])
  for (const row of content.marks)
    if (marks.has(row.id)) add(critical, row.presentation?.icon, 'image', `${row.name || row.id} · 图标`)
  return { critical, deferred: [...movies, ...sounds], effects }
}

function preloadEnvironment(
  assets: Asset[],
  environment: MediaEnvironment,
  signal: AbortSignal,
  label: string,
  teamUrls: ReadonlySet<string>,
) {
  let pending = assets
  return withPreloadBackoff(signal, async () => {
    const failedUrls = new Set<string>()
    const failed = await preloadMedia(pending, environment, signal, { label, background: true, teamUrls, failedUrls })
    if (failed) pending = pending.filter(asset => failedUrls.has(asset.url))
    return failed
  })
}

export function createMediaPreloader(label: string, scope: 'team' | 'environment' = 'team') {
  let current:
    { environment: MediaEnvironment; key: string; controller: AbortController; done: Promise<number> } | undefined
  function stop() {
    current?.controller.abort()
    current = undefined
  }
  return {
    stop,
    get ready() {
      return current?.done
    },
    update(
      content: MediaCatalog | null,
      pets: readonly MediaPet[],
      settings: PreloadSettings,
      globalMarks: readonly string[] = [],
    ) {
      if (!content) {
        stop()
        return false
      }
      const environment = mediaEnvironment(content)
      const full = scope === 'environment'
      const key = full
        ? ''
        : JSON.stringify([pets, globalMarks, settings.battleRenderer, settings.background, settings.battleMusic])
      if (current?.environment === environment && current.key === key) return false

      const { critical, deferred, effects } = teamMediaAssets(content, environment, pets, settings, globalMarks)
      const previous = current
      const controller = new AbortController()
      const { signal } = controller
      let done: Promise<number>
      if (full) {
        const team = [...critical, ...deferred, ...effects]
        done = preloadEnvironment(
          [...team, ...allEnvironmentAssets(content, environment)],
          environment,
          signal,
          label,
          new Set(team.map(asset => asset.url)),
        )
      } else {
        // `ready` covers only what the battle page waits for. Deferred reads yield to it between items.
        done = preloadMedia(critical, environment, signal, { label })
        const later = deferred.length
          ? preloadMedia(deferred, environment, signal, { label: `${label} · 动画与音效`, priority: 'deferred' })
          : Promise.resolve(0)
        if (effects.length)
          void later.finally(() =>
            preloadMedia(effects, environment, signal, { label: `${label} · 特效`, priority: 'deferred' }),
          )
      }
      current = { environment, key, controller, done }
      // Join shared reads before releasing the previous selection's subscriptions.
      previous?.controller.abort()
      return true
    },
  }
}
