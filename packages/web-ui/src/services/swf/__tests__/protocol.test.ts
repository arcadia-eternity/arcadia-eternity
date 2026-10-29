import { describe, expect, it } from 'vitest'
import { assertSwfBytes, validSwfEvent } from '../protocol'
const base = { v: 1, instance: 'test', task: 1, seq: 1 }
describe('bounded SWF cosmetic messages', () => {
  it('accepts finite state callbacks', () => expect(validSwfEvent({ ...base, type: 'hit', state: '待机' })).toBe(true))
  it.each([
    { ...base, type: 'execute', script: 'parent.document.cookie' },
    { ...base, type: 'hit', state: 'unknown' },
    { ...base, type: 'complete', state: '待机', duration: Infinity },
    { ...base, type: 'ready', states: new Array(1000).fill('待机') },
    { ...base, type: 'error', message: 'x'.repeat(241) },
    { ...base, type: 'hit', state: '待机', seq: 0 },
  ])('rejects malformed/oversize/executable input', value => expect(validSwfEvent(value)).toBe(false))
  it('rejects spoofed expanded SWF sizes and invalid formats', () => {
    const b = new ArrayBuffer(8)
    new Uint8Array(b).set([67, 87, 83, 9])
    new DataView(b).setUint32(4, 100 * 1024 * 1024, true)
    expect(() => assertSwfBytes({ container: b, movie: b })).toThrow('expanded')
    expect(() => assertSwfBytes({ container: new ArrayBuffer(10), movie: b })).toThrow('format')
  })
})

it('bounds the actual decompressed stream even when the header lies', async () => {
  const { Blob: NativeBlob } = await import('node:buffer')
  const { deflateSync } = await import('node:zlib')
  const { vi } = await import('vitest')
  const { validateSwfBytes } = await import('../protocol')
  vi.stubGlobal('Blob', NativeBlob)
  try {
    const compressed = deflateSync(new Uint8Array(1024 * 1024))
    const data = new Uint8Array(compressed.length + 8)
    data.set([67, 87, 83, 9, 20, 0, 0, 0])
    data.set(compressed, 8)
    await expect(validateSwfBytes({ container: data.buffer, movie: data.buffer })).rejects.toThrow('expanded size')
  } finally {
    vi.unstubAllGlobals()
  }
})

it('bounds host-rendered dirty PNG frames before image decoding', async () => {
  const { validSwfFrame } = await import('../protocol')
  const png = new Uint8Array(33)
  png.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])
  new DataView(png.buffer).setUint32(16, 100)
  new DataView(png.buffer).setUint32(20, 80)
  const frame = {
    v: 1,
    instance: 'owned',
    task: 1,
    frame: 1,
    canvasWidth: 1600,
    canvasHeight: 900,
    x: 20,
    y: 30,
    width: 100,
    height: 80,
    png,
  }
  expect(validSwfFrame(frame)).toBe(true)
  for (const overrides of [
    { canvasWidth: 2049 },
    { canvasHeight: 2048 },
    { x: -1 },
    { x: 1550 },
    { y: Infinity },
    { task: 0 },
    { frame: 0 },
    { png: new Uint8Array(8 * 1024 * 1024 + 1) },
    { width: 101 },
    { png: new Uint8Array(33) },
    { extra: 'untrusted' },
  ])
    expect(validSwfFrame({ ...frame, ...overrides })).toBe(false)
})
