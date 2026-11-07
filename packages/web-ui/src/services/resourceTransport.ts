/** Per-consumer transport. Limits apply to actual streamed bytes, never just HTTP headers. */
export const RESOURCE_MAX_BYTES = 64 * 1024 * 1024
export const METADATA_MAX_BYTES = 16 * 1024 * 1024

const ownedResources = new Map<string, { blob: Blob; controller: AbortController }>()

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
  options: { signal?: AbortSignal; maxBytes?: number; timeoutMs?: number; bundledEnvironment?: boolean } = {},
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
  const timer = setTimeout(() => controller.abort(new Error('资源请求超时')), timeout)
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
            cache: 'no-store',
            credentials: 'omit',
            redirect: 'error',
            referrerPolicy: 'no-referrer',
            signal: controller.signal,
          }),
      aborted,
    ])
    if (!response.ok || response.redirected) throw new Error(`资源请求失败（${response.status}）`)
    if (!response.body) throw new Error('资源响应为空')
    reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { done, value: chunk } = await Promise.race([reader.read(), aborted])
      if (done) break
      size += chunk.byteLength
      if (size > limit) throw new Error('资源超过大小限制')
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
