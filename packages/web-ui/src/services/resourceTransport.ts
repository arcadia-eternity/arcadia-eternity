/** Per-consumer transport. These limits apply to actual decoded HTTP body bytes, never just headers. */
export const RESOURCE_MAX_BYTES = 64 * 1024 * 1024
export const METADATA_MAX_BYTES = 16 * 1024 * 1024

export function publicHttpUrl(value: string): URL {
  const url = new URL(value, globalThis.location?.href ?? 'http://localhost/')
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash)
    throw new Error('资源地址无效')
  return url
}

export async function readResourceBytes(
  value: string,
  options: { signal?: AbortSignal; maxBytes?: number } = {},
  request: typeof fetch = fetch,
): Promise<Uint8Array> {
  const url = publicHttpUrl(value)
  const limit = options.maxBytes ?? RESOURCE_MAX_BYTES
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > RESOURCE_MAX_BYTES) throw new Error('资源大小限制无效')
  const response = await request.call(globalThis, url.toString(), {
    cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: options.signal,
  })
  if (!response.ok || response.redirected) throw new Error(`资源请求失败（${response.status}）`)
  if (!response.body) throw new Error('资源响应为空')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      options.signal?.throwIfAborted()
      const { done, value: chunk } = await reader.read()
      if (done) break
      size += chunk.byteLength
      if (size > limit) throw new Error('资源超过大小限制')
      chunks.push(chunk)
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}
