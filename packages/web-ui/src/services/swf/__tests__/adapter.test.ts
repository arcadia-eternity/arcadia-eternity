import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSwfPlayer } from '../adapter'
import type { SwfCommand, SwfFrame } from '../protocol'

const data = new Uint8Array([70, 87, 83, 9, 8, 0, 0, 0]).buffer
function png(width: number, height: number) {
  const bytes = new Uint8Array(33)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  return bytes
}
const context = { clearRect: vi.fn(), drawImage: vi.fn() }
let bitmap: { width: number; height: number; close: ReturnType<typeof vi.fn> }
beforeEach(() => {
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  )
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  bitmap = { width: 1600, height: 900, close: vi.fn() }
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => bitmap),
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
})
afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  delete (window as Window & { arcadiaSwf?: unknown }).arcadiaSwf
})
function harness() {
  let event: (value: unknown) => void = () => {}
  let frame: (value: unknown) => void = () => {}
  const sent: SwfCommand[] = []
  const bridge = {
    create: vi.fn(async () => {}),
    send: vi.fn(async (command: SwfCommand) => {
      sent.push(command)
    }),
    bounds: vi.fn(async (_value: unknown) => {}),
    dispose: vi.fn(async () => {}),
    ackFrame: vi.fn(),
    unsubscribeEvent: vi.fn(),
    unsubscribeFrame: vi.fn(),
    onEvent: (fn: typeof event) => {
      event = fn
      return bridge.unsubscribeEvent
    },
    onFrame: (fn: typeof frame) => {
      frame = fn
      return bridge.unsubscribeFrame
    },
  }
  Object.assign(window, { arcadiaSwf: bridge })
  const element = document.createElement('div')
  Object.defineProperties(element, { clientWidth: { value: 1600 }, clientHeight: { value: 900 } })
  document.body.append(element)
  const events = vi.fn()
  const player = createSwfPlayer(element, events)
  const load = () => player.load({ container: data, movie: data })
  const owner = () => sent.findLast(command => command.type === 'load')!
  const ready = () => event({ ...owner(), type: 'ready', seq: 1, states: ['待机', '物理攻击'] })
  const image = (overrides: Partial<SwfFrame> = {}) => ({
    v: 1,
    instance: owner().instance,
    task: owner().task,
    frame: 1,
    canvasWidth: 1600,
    canvasHeight: 900,
    x: 0,
    y: 0,
    width: 1600,
    height: 900,
    png: png(1600, 900),
    ...overrides,
  })
  return {
    bridge,
    element,
    events,
    player,
    load,
    owner,
    ready,
    image,
    event: (x: unknown) => event(x),
    frame: (x: unknown) => frame(x),
    sent,
  }
}

describe('owned desktop canvas playback', () => {
  it('waits for native creation, matching ready AND a drawn full frame; uses logical layout without modal hiding', async () => {
    const h = harness()
    let finishCreate!: () => void
    h.bridge.create.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          finishCreate = resolve
        }),
    )
    const loading = h.load()
    let ready = false
    void loading.then(() => {
      ready = true
    })
    await vi.waitFor(() => expect(h.bridge.create).toHaveBeenCalledOnce())
    expect(h.sent).toEqual([])
    finishCreate()
    await vi.waitFor(() => expect(h.sent).toHaveLength(1))
    expect(h.bridge.bounds).toHaveBeenCalledWith({ instance: h.owner().instance, width: 1600, height: 900 })
    h.ready()
    expect(ready).toBe(false)
    h.frame(h.image())
    await expect(loading).resolves.toEqual(['待机', '物理攻击'])
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 1600, 900)
    expect(context.drawImage).toHaveBeenCalledWith(bitmap, 0, 0)
    expect(bitmap.close).toHaveBeenCalledOnce()
    expect(h.bridge.ackFrame).toHaveBeenCalledWith({ instance: h.owner().instance, task: 1, frame: 1 })
    const canvas = h.element.querySelector<HTMLCanvasElement>('canvas[data-swf-player]')!
    expect([canvas.width, canvas.height]).toEqual([1600, 900])
    expect(canvas.style.pointerEvents).toBe('none')
    expect(canvas.style.width).toBe('100%')
    const modal = document.createElement('dialog')
    modal.open = true
    document.body.append(modal)
    h.player.configure({ reverse: true, width: 1600, height: 900 })
    expect(h.bridge.bounds).toHaveBeenCalledOnce()
    expect(h.sent.at(-1)).toMatchObject({ type: 'configure', bounds: { reverse: true, width: 1600, height: 900 } })
    h.player.dispose()
    expect(h.element.querySelector('canvas')).toBeNull()
    expect(h.bridge.unsubscribeEvent).toHaveBeenCalledOnce()
    expect(h.bridge.unsubscribeFrame).toHaveBeenCalledOnce()
  })

  it('ignores forged/replayed callbacks and acknowledges stale frames without decoding', async () => {
    const h = harness(),
      loading = h.load()
    await vi.waitFor(() => expect(h.sent).toHaveLength(1))
    const owner = h.owner()
    const ready = { ...owner, type: 'ready', seq: 1, states: ['待机'] }
    h.event({ ...ready, instance: 'attacker' })
    h.event({ ...ready, task: 999 })
    h.event({ ...ready, states: ['execute'] })
    h.frame(h.image({ instance: 'attacker' }))
    h.frame(h.image({ task: 999 }))
    expect(h.events).not.toHaveBeenCalled()
    expect(createImageBitmap).not.toHaveBeenCalled()
    h.event(ready)
    h.frame(h.image())
    await loading
    h.event(ready)
    h.frame(h.image())
    expect(h.events).toHaveBeenCalledOnce()
    expect(createImageBitmap).toHaveBeenCalledOnce()
    expect(h.bridge.ackFrame).toHaveBeenCalledTimes(2)
    h.player.dispose()
    h.event({ ...ready, seq: 2, type: 'hit', state: '待机' })
    h.frame(h.image({ frame: 2 }))
    expect(h.events).toHaveBeenCalledOnce()
    expect(createImageBitmap).toHaveBeenCalledOnce()
  })

  it.each(['replace', 'dispose'] as const)(
    'closes and ACKs an in-flight decoded bitmap after %s without painting',
    async action => {
      const h = harness()
      let decoded!: (value: typeof bitmap) => void
      vi.mocked(createImageBitmap).mockImplementationOnce(
        () =>
          new Promise(resolve => {
            decoded = resolve
          }),
      )
      const loading = h.load()
      void loading.catch(() => {})
      await vi.waitFor(() => expect(h.sent).toHaveLength(1))
      h.ready()
      h.frame(h.image())
      const oldBitmap = bitmap
      if (action === 'dispose') h.player.dispose()
      else {
        const replacement = h.load()
        void replacement.catch(() => {})
        await vi.waitFor(() => expect(h.sent.filter(command => command.type === 'load')).toHaveLength(2))
      }
      decoded(oldBitmap as unknown as ImageBitmap)
      await vi.waitFor(() => expect(oldBitmap.close).toHaveBeenCalledOnce())
      expect(context.drawImage).not.toHaveBeenCalled()
      expect(h.bridge.ackFrame).toHaveBeenCalledWith(expect.objectContaining({ task: 1, frame: 1 }))
      if (action === 'replace') h.player.dispose()
    },
  )

  it('clears dirty alpha pixels before drawing and ACKs only after completion', async () => {
    const h = harness(),
      loading = h.load()
    await vi.waitFor(() => expect(h.sent).toHaveLength(1))
    h.frame(h.image())
    await vi.waitFor(() => expect(bitmap.close).toHaveBeenCalledOnce())
    let finished = false
    void loading.then(() => {
      finished = true
    })
    await Promise.resolve()
    expect(finished).toBe(false)
    h.ready()
    await loading
    bitmap = { width: 100, height: 80, close: vi.fn() }
    h.frame(h.image({ frame: 2, x: 20, y: 30, width: 100, height: 80, png: png(100, 80) }))
    expect(h.bridge.ackFrame).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(bitmap.close).toHaveBeenCalledOnce())
    expect(context.clearRect).toHaveBeenLastCalledWith(20, 30, 100, 80)
    expect(context.drawImage).toHaveBeenLastCalledWith(bitmap, 20, 30)
    expect(h.bridge.ackFrame).toHaveBeenCalledTimes(2)
    expect(context.clearRect.mock.invocationCallOrder.at(-1)).toBeLessThan(
      context.drawImage.mock.invocationCallOrder.at(-1)!,
    )
    h.player.dispose()
  })

  it('refuses a partial first frame instead of accepting stale pixels', async () => {
    const h = harness(),
      loading = h.load()
    void loading.catch(() => {})
    await vi.waitFor(() => expect(h.sent).toHaveLength(1))
    h.ready()
    bitmap = { width: 100, height: 80, close: vi.fn() }
    h.frame(h.image({ width: 100, height: 80, png: png(100, 80) }))
    await expect(loading).rejects.toThrow('frame unavailable')
    expect(context.drawImage).not.toHaveBeenCalled()
    expect(bitmap.close).toHaveBeenCalledOnce()
    expect(h.bridge.ackFrame).toHaveBeenCalledOnce()
    h.player.dispose()
  })

  it('rejects malformed current frames before decoding, ACKs once and falls back', async () => {
    const h = harness(),
      loading = h.load()
    void loading.catch(() => {})
    await vi.waitFor(() => expect(h.sent).toHaveLength(1))
    h.ready()
    const invalid = h.image({ width: 2049 })
    h.frame(invalid)
    await expect(loading).rejects.toThrow('Invalid desktop playback frame')
    expect(createImageBitmap).not.toHaveBeenCalled()
    expect(h.bridge.ackFrame).toHaveBeenCalledOnce()
    expect(h.bridge.dispose).toHaveBeenCalled()
    expect(h.element.querySelector('canvas')).toBeNull()
    h.player.dispose()
  })

  it('ACKs decoder rejection and does not leave a blank canvas marked ready', async () => {
    const h = harness(),
      loading = h.load()
    void loading.catch(() => {})
    vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error('bad png'))
    await vi.waitFor(() => expect(h.sent).toHaveLength(1))
    h.ready()
    h.frame(h.image())
    await expect(loading).rejects.toThrow('frame unavailable')
    expect(h.bridge.ackFrame).toHaveBeenCalledOnce()
    expect(h.element.querySelector('canvas')).toBeNull()
    h.player.dispose()
  })

  it('requires the frame capability instead of silently mounting a native view', async () => {
    const h = harness()
    Object.assign(h.bridge, { onFrame: undefined })
    await expect(h.load()).rejects.toThrow('Desktop frame playback unavailable')
    expect(h.bridge.create).not.toHaveBeenCalled()
    expect(h.element.children).toHaveLength(0)
    h.player.dispose()
  })
})
