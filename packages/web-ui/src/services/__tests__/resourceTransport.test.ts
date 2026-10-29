import { expect, it, vi } from 'vitest'
import { readResourceBytes } from '../resourceTransport'
import { imageResourceBlob } from '../imageResource'

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
