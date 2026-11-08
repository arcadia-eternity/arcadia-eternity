import type { SandboxEnvironment } from '@arcadia-eternity/battle/sandbox'
import { mapPresentationResources } from '@arcadia-eternity/pack-loader/native'
import type { ServerEnvironmentContent } from '@arcadia-eternity/protocol'
import type { PresentationManifest } from '@arcadia-eternity/schema'
import { isDesktop } from '@/utils/env'
import { publicHttpUrl, readResourceBytes } from './resourceTransport'
import { readEnvironmentJson } from './serverEnvironment'
import { validateEnvironmentContent } from './serverContentValidation'
import type { EffectMarkRelations } from './skillMarkRelationService'

type PreparedCatalog = {
  content: ServerEnvironmentContent
  resources: PresentationManifest['resources']
  runtimeRevision: string
  effectMarkRelations?: EffectMarkRelations
}

export function hasPreparedWebEnvironment(): boolean {
  return (
    !isDesktop &&
    import.meta.env.VITE_PREPARED_ENVIRONMENT === '1' &&
    !import.meta.env.VITE_PACK_REF?.trim() &&
    !import.meta.env.VITE_API_BASE?.trim()
  )
}

const webRoot = () => new URL(import.meta.env.BASE_URL, window.location.href)
let catalog: { promise: Promise<PreparedCatalog>; ready: boolean } | undefined
let runtime: SandboxEnvironment | undefined

/** Stores share the decoded catalog for this bundled environment. */
export function readPreparedWebCatalog(refresh = false): Promise<PreparedCatalog> {
  if (catalog && (!refresh || !catalog.ready)) return catalog.promise
  const root = webRoot()
  const entry = {
    ready: false,
    promise: readEnvironmentJson<PreparedCatalog>(
      new URL('environment/catalog.json', root).href,
      fetch,
      undefined,
      true,
    ).then(value => {
      validateEnvironmentContent(value?.content, { includeRuleDetails: true })
      if (!Array.isArray(value.resources) || typeof value.runtimeRevision !== 'string' || !value.runtimeRevision)
        throw new Error('本机展示资源索引无效')
      const resolve = (source: string) => {
        const path = source.startsWith('pack-assets/') ? source.split('/').map(encodeURIComponent).join('/') : source
        return publicHttpUrl(new URL(path, root).href).href
      }
      for (const kind of ['species', 'skills', 'marks'] as const)
        for (const row of value.content[kind])
          if (row.presentation)
            row.presentation = mapPresentationResources(row.presentation, reference => {
              if (typeof reference !== 'string') throw new Error('本机展示资源引用无效')
              return resolve(reference)
            })
      for (const resource of value.resources) resource.source = resolve(resource.source)
      entry.ready = true
      return value
    }),
  }
  catalog = entry
  void entry.promise.catch(() => {
    if (catalog === entry) catalog = undefined
  })
  return entry.promise
}

/** The shipped environment carries its own executable recipe alongside its display catalog. */
export async function readPreparedWebRuntime(signal?: AbortSignal): Promise<SandboxEnvironment> {
  signal?.throwIfAborted()
  const explicit = import.meta.env.VITE_RUNTIME_REF?.trim()
  if (!explicit && !hasPreparedWebEnvironment()) throw new Error('当前环境缺少本地对战运行材料')
  const expected = explicit ? undefined : (await readPreparedWebCatalog()).runtimeRevision
  signal?.throwIfAborted()
  if (runtime && expected === runtime.revision) return runtime
  const url = explicit || new URL('environment/runtime.json', webRoot()).href
  const bytes = await readResourceBytes(url, { signal, bundledEnvironment: !explicit })
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as SandboxEnvironment
  if (
    typeof value?.revision !== 'string' ||
    (expected !== undefined && value.revision !== expected) ||
    !Array.isArray(value.modules) ||
    !Array.isArray(value.data?.species) ||
    !Array.isArray(value.data.skills) ||
    !Array.isArray(value.data.marks)
  )
    throw new Error('本地对战运行材料无效')
  if (expected !== undefined) runtime = value
  return value
}
