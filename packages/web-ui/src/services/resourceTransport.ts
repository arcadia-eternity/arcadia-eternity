/** Per-consumer transport. Limits apply to actual streamed bytes, never just HTTP headers. */
import { mediaLimits } from '../../shared/media-formats.mjs'
export const RESOURCE_MAX_BYTES = mediaLimits.image
export class ResourceSizeError extends Error {
  constructor() {
    super('资源超过大小限制')
  }
}
export const METADATA_MAX_BYTES = 16 * 1024 * 1024

type OwnedResource = { blob: Blob; controller: AbortController }
const ownedResources = new Map<string, OwnedResource>()

export const hasOwnedResource = (url: string) => ownedResources.has(url)

/** Only explicitly imported local bytes can enter this registry; it is not a network or package cache. */
export function registerOwnedResource(blob: Blob): { url: string; release(): void } {
  if (
    !blob ||
    typeof blob.stream !== 'function' ||
    !Number.isSafeInteger(blob.size) ||
    blob.size < 0 ||
    blob.size > RESOURCE_MAX_BYTES
  )
    throw new Error('本地资源大小或格式无效')
  const url = URL.createObjectURL(blob)
  if (!url.startsWith('blob:') || ownedResources.has(url)) {
    URL.revokeObjectURL(url)
    throw new Error('本地资源地址无效')
  }
  const entry = { blob, controller: new AbortController() }
  ownedResources.set(url, entry)
  let released = false
  return {
    url,
    release() {
      if (released) return
      released = true
      ownedResources.delete(url)
      entry.controller.abort(new Error('本地资源已释放'))
      URL.revokeObjectURL(url)
    },
  }
}

export function publicHttpUrl(value: string): URL {
  const url = new URL(value, globalThis.location?.href ?? 'http://localhost/')
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash)
    throw new Error('资源地址无效')
  return url
}

export async function readResourceBytes(
  value: string,
  options: {
    signal?: AbortSignal
    maxBytes?: number
    timeoutMs?: number
    bundledEnvironment?: boolean
    cache?: RequestCache
  } = {},
  request: typeof fetch = fetch,
): Promise<Uint8Array> {
  const owned = ownedResources.get(value)
  const candidate = new URL(value, globalThis.location?.href ?? 'http://localhost/')
  const bundled =
    options.bundledEnvironment &&
    globalThis.location?.protocol === 'arcadia-client:' &&
    candidate.protocol === 'arcadia-client:' &&
    candidate.host === 'app' &&
    !candidate.username &&
    !candidate.password &&
    !candidate.search &&
    !candidate.hash &&
    /^\/environment\/(catalog|runtime)\.json$/.test(candidate.pathname)
  const url = owned || bundled ? candidate : publicHttpUrl(value)
  return readBytes(url, options, request, owned)
}

// This installed application asset is also available through Electron's local application protocol.
const playerReadOptions = { idleTimeoutMs: 5 * 60_000, cache: 'default' } as const

export function readBundledSwfContainer(signal: AbortSignal) {
  const url = new URL('../../node_modules/seer2-pet-animator/dist/assets/37f0cd22be23b7c7.swf', import.meta.url)
  return readBytes(url, { ...playerReadOptions, signal, maxBytes: mediaLimits.swf }, fetch)
}

export function readBundledRuffleFile(name: string, signal: AbortSignal, cache: RequestCache) {
  const url = new URL(`${import.meta.env.BASE_URL}ruffle/${name}`, location.href)
  return readBytes(publicHttpUrl(url.href), { ...playerReadOptions, signal, cache, maxBytes: 32 * 1024 * 1024 }, fetch)
}

async function readBytes(
  url: URL,
  options: {
    signal?: AbortSignal
    maxBytes?: number
    timeoutMs?: number
    idleTimeoutMs?: number
    cache?: RequestCache
  },
  request: typeof fetch,
  owned?: OwnedResource,
) {
  const limit = options.maxBytes ?? RESOURCE_MAX_BYTES
  const timeout = options.timeoutMs ?? 20_000
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > RESOURCE_MAX_BYTES ||
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 60_000
  )
    throw new Error('资源大小或时间限制无效')
  const controller = new AbortController()
  const cancel = () => controller.abort(options.signal?.reason)
  const cancelOwned = () => controller.abort(owned?.controller.signal.reason)
  options.signal?.addEventListener('abort', cancel, { once: true })
  owned?.controller.signal.addEventListener('abort', cancelOwned, { once: true })
  if (options.signal?.aborted) cancel()
  if (owned?.controller.signal.aborted) cancelOwned()
  const timeOut = () => controller.abort(new Error('资源请求超时'))
  let timer = setTimeout(timeOut, options.idleTimeoutMs ?? timeout)
  const receivedData = () => {
    if (options.idleTimeoutMs) {
      clearTimeout(timer)
      timer = setTimeout(timeOut, options.idleTimeoutMs)
    }
  }
  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(controller.signal.reason ?? new Error('资源请求已取消'))
    controller.signal.addEventListener('abort', onAbort, { once: true })
    if (controller.signal.aborted) onAbort()
  })
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const response = await Promise.race([
      owned
        ? Promise.resolve(new Response(owned.blob.stream()))
        : request.call(globalThis, url.toString(), {
            cache: options.cache ?? 'no-store',
            credentials: 'omit',
            redirect: 'error',
            referrerPolicy: 'no-referrer',
            signal: controller.signal,
          }),
      aborted,
    ])
    if (!response.ok || response.redirected) throw new Error(`资源请求失败（${response.status}）`)
    if (!response.body) throw new Error('资源响应为空')
    receivedData()
    reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { done, value: chunk } = await Promise.race([reader.read(), aborted])
      if (done) break
      if (!chunk.byteLength) continue
      receivedData()
      size += chunk.byteLength
      if (size > limit) throw new ResourceSizeError()
      chunks.push(chunk)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return bytes
  } catch (error) {
    controller.abort(error)
    void reader?.cancel().catch(() => {})
    throw error
  } finally {
    reader?.releaseLock()
    clearTimeout(timer)
    if (onAbort) controller.signal.removeEventListener('abort', onAbort)
    options.signal?.removeEventListener('abort', cancel)
    owned?.controller.signal.removeEventListener('abort', cancelOwned)
  }
}
