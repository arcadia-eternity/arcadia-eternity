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

type Asset = { url: string; kind?: MediaKind; limit?: number; label?: string }
export type MediaPet = {
  species: string
  elements?: readonly string[]
  skills?: readonly string[]
  ability?: string
  emblem?: string
  marks?: readonly string[]
}
function presentationAssets(
  row: { id: string; name?: string; presentation?: ContentPresentation },
  movies: boolean,
): Asset[] {
  const p = row.presentation
  if (!p) return []
  const assets: Asset[] = []
  const add = (url: unknown, label: string, kind: MediaKind = 'image') => {
    if (typeof url === 'string' && url)
      assets.push({ url: officialAssetUrl(url), kind, label: `${row.name || row.id} · ${label}` })
  }
  if (p.battle?.renderer !== 'seer2-swf' || movies)
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

function presentationMedia(
  content: MediaCatalog,
  pets?: readonly MediaPet[],
  movies = true,
  globalMarks: readonly string[] = [],
): Asset[] {
  if (!pets)
    return [content.species, content.skills, content.marks].flatMap(rows =>
      rows.flatMap(row => presentationAssets(row, movies)),
    )
  const bySpecies = new Map(content.species.map(row => [row.id as string, row]))
  const skills = new Set(pets.flatMap(p => p.skills ?? []))
  const marks = new Set([...globalMarks, ...pets.flatMap(p => [p.ability, p.emblem, ...(p.marks ?? [])])])
  return [
    ...pets.flatMap(p => {
      const species = bySpecies.get(p.species)
      return species ? presentationAssets(species, movies) : []
    }),
    ...content.skills.filter(row => skills.has(row.id)).flatMap(row => presentationAssets(row, movies)),
    ...content.marks.filter(row => marks.has(row.id)).flatMap(row => presentationAssets(row, movies)),
  ]
}

export function allEnvironmentAssets(content: MediaCatalog, environment: MediaEnvironment): Asset[] {
  const declared = environment.resources.map(row => {
    return { url: officialAssetUrl(row.source), label: row.id, kind: mediaKindForResource(row) }
  })
  return [...presentationMedia(content), ...declared]
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
  }: {
    save?: (completed: number, total: number, failed: number) => void
    label?: string
    background?: boolean
    teamUrls?: ReadonlySet<string>
    failedUrls?: Set<string>
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
  const waiting = background ? new Map(items.map((item, index) => [item.url, index])) : undefined
  const promoted = new Set<Promise<void>>()
  let next = 0
  function processItem(index: number, urgent = false) {
    const { url, kind, limit, label } = items[index]!
    return batch.run(index, label ?? `资源 ${index + 1}`, () => {
      if (typeConflicts.has(url)) throw new Error('同一资源地址声明了不同的媒体类型')
      const options = { environment, signal, kind, maxBytes: limit, background, requireSave: !!save }
      if (save || (background && !urgent)) return ensureMediaCached(url, options, teamUrls?.has(url))
      return warmMedia(url, options)
    })
  }
  function promote(url: string) {
    const index = waiting?.get(url)
    if (index === undefined || signal.aborted) return
    waiting!.delete(url)
    const task = processItem(index, true)
    promoted.add(task)
    void task.then(() => promoted.delete(task))
  }
  async function worker() {
    while (!signal.aborted && next < items.length) {
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
function teamMediaAssets(
  content: MediaCatalog,
  env: MediaEnvironment,
  pets: readonly MediaPet[],
  settings: PreloadSettings,
  globalMarks: readonly string[] = [],
) {
  const scene = (['background', 'music'] as const).flatMap(tag => {
    const url = battleScene(env, tag, tag === 'music' ? settings.battleMusic : settings.background)
    return url
      ? [
          {
            url,
            label: tag === 'music' ? '战斗音乐' : '战斗背景',
            kind: tag === 'music' ? ('audio' as const) : ('image' as const),
          },
        ]
      : []
  })
  const elements = [...new Set(pets.flatMap(pet => pet.elements ?? []))].flatMap(element => {
    const url = battleUiUrl('element:' + element, true, env)
    return url ? [{ url, kind: 'image' as const, label: element }] : []
  })
  return [...scene, ...elements, ...presentationMedia(content, pets, settings.battleRenderer !== 'image', globalMarks)]
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

      const assets = teamMediaAssets(content, environment, pets, settings, globalMarks)
      const previous = current
      const controller = new AbortController()
      const done = full
        ? preloadEnvironment(
            [...assets, ...allEnvironmentAssets(content, environment)],
            environment,
            controller.signal,
            label,
            new Set(assets.map(asset => asset.url)),
          )
        : preloadMedia(assets, environment, controller.signal, { label })
      current = { environment, key, controller, done }
      // Join shared reads before releasing the previous selection's subscriptions.
      previous?.controller.abort()
      return true
    },
  }
}
