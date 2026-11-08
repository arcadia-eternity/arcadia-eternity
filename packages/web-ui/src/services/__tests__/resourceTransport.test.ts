import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Blob as NodeBlob } from 'node:buffer'
import { readResourceBytes, registerOwnedResource } from '../resourceTransport'
import { imageResourceBlob } from '../imageResource'

const OriginalURL = globalThis.URL
const revokeObjectURL = vi.fn()
const owned: Array<ReturnType<typeof registerOwnedResource>> = []
beforeEach(() => {
  vi.stubGlobal('Blob', NodeBlob)
  let sequence = 0
  revokeObjectURL.mockClear()
  vi.stubGlobal(
    'URL',
    class extends OriginalURL {
      static createObjectURL = vi.fn(() => `blob:owned-test/${++sequence}`)
      static revokeObjectURL = revokeObjectURL
    },
  )
})
afterEach(() => {
  for (const resource of owned.splice(0)) resource.release()
  vi.unstubAllGlobals()
})
function own(blob: Blob) {
  const resource = registerOwnedResource(blob)
  owned.push(resource)
  return resource
}

it('reads explicitly owned local bytes through the normal transport without fetching or caching', async () => {
  const resource = own(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }))
  const request = vi.fn()
  const first = await readResourceBytes(resource.url, {}, request as typeof fetch)
  const second = await readResourceBytes(resource.url, {}, request as typeof fetch)
  expect(first).toEqual(new Uint8Array([1, 2, 3]))
  expect(second).toEqual(first)
  expect(second).not.toBe(first)
  expect(request).not.toHaveBeenCalled()
  resource.release()
  resource.release()
  expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(resource.url)
  await expect(readResourceBytes(resource.url, {}, request as typeof fetch)).rejects.toThrow('地址无效')
  expect(request).not.toHaveBeenCalled()
})

it('applies consumer byte limits to owned resources', async () => {
  const resource = own(new Blob([new Uint8Array(9)]))
  const request = vi.fn()
  await expect(readResourceBytes(resource.url, { maxBytes: 8 }, request as typeof fetch)).rejects.toThrow('大小限制')
  expect(request).not.toHaveBeenCalled()
})

it.each(['owner release', 'caller cancellation'])('stops an in-flight owned read on %s', async reason => {
  const cancel = vi.fn(),
    pull = vi.fn()
  const blob = new Blob([new Uint8Array([1])])
  vi.spyOn(blob, 'stream').mockImplementation(() => new ReadableStream<Uint8Array<ArrayBuffer>>({ pull, cancel }))
  const resource = own(blob)
  const request = vi.fn()
  const controller = new AbortController()
  const pending = readResourceBytes(resource.url, { signal: controller.signal }, request as typeof fetch)
  const rejected = expect(pending).rejects.toThrow(reason === 'owner release' ? '已释放' : 'cancelled')
  await vi.waitFor(() => expect(pull).toHaveBeenCalled())
  if (reason === 'owner release') resource.release()
  else controller.abort(new Error('cancelled'))
  await rejected
  expect(cancel).toHaveBeenCalledOnce()
  expect(request).not.toHaveBeenCalled()
})

it('rejects unregistered blobs and arbitrary local/custom addresses without fetching', async () => {
  const request = vi.fn()
  for (const url of [
    'blob:unregistered/media',
    'file:///tmp/private.png',
    'arcadia-resource:unregistered',
    'javascript:alert(1)',
  ])
    await expect(readResourceBytes(url, {}, request as typeof fetch)).rejects.toThrow('地址无效')
  expect(request).not.toHaveBeenCalled()
})

it('counts actual streamed bytes despite a false content length and cancels overflow', async () => {
  const cancel = vi.fn()
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(5))
        controller.enqueue(new Uint8Array(5))
      },
      cancel,
    }),
    { headers: { 'content-length': '1', 'content-type': 'image/png' } },
  )
  const request = vi.fn(async () => response)
  await expect(readResourceBytes('https://media.test/image', { maxBytes: 8 }, request as typeof fetch)).rejects.toThrow(
    '大小限制',
  )
  expect(cancel).toHaveBeenCalledOnce()
  expect(request).toHaveBeenCalledWith(
    'https://media.test/image',
    expect.objectContaining({
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    }),
  )
})

it('times out a stalled body and preserves caller cancellation', async () => {
  vi.useFakeTimers()
  try {
    const cancelled = vi.fn()
    const request = vi.fn(async () => new Response(new ReadableStream({ cancel: cancelled }))) as typeof fetch
    const timed = expect(readResourceBytes('https://media.test/stalled', { timeoutMs: 20 }, request)).rejects.toThrow(
      '超时',
    )
    await vi.advanceTimersByTimeAsync(21)
    await timed
    expect(cancelled).toHaveBeenCalledOnce()
    const controller = new AbortController()
    const pending = expect(
      readResourceBytes('https://media.test/stalled', { signal: controller.signal }, request),
    ).rejects.toThrow('cancelled')
    controller.abort(new Error('cancelled'))
    await pending
  } finally {
    vi.useRealTimers()
  }
})

it('rejects credential-bearing/non-HTTP addresses and followed redirects', async () => {
  for (const url of ['https://user:password@media.test/a', 'javascript:alert(1)', 'file:///tmp/a'])
    await expect(readResourceBytes(url)).rejects.toThrow('地址无效')
  const response = new Response('redirected')
  Object.defineProperty(response, 'redirected', { value: true })
  await expect(
    readResourceBytes('https://media.test/a', {}, vi.fn(async () => response) as typeof fetch),
  ).rejects.toThrow('请求失败')
})

it('checks image dimensions from bytes rather than MIME and rejects active formats', () => {
  const png = new Uint8Array(24)
  png.set([137, 80, 78, 71])
  png.set([73, 72, 68, 82], 12)
  const view = new DataView(png.buffer)
  view.setUint32(16, 16)
  view.setUint32(20, 16)
  expect(imageResourceBlob(png).type).toBe('image/png')
  view.setUint32(16, 100_000)
  expect(() => imageResourceBlob(png)).toThrow('尺寸')
  expect(() => imageResourceBlob(new TextEncoder().encode('<svg onload="alert(1)"/>'))).toThrow('格式')
})
