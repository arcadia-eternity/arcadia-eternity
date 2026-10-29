import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSwfPlayer } from '../adapter'
import type { SwfCommand } from '../protocol'
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete (window as Window & { arcadiaSwf?: unknown }).arcadiaSwf
})
describe('owned playback callbacks', () => {
  it('ignores forged, replayed, old task, and disposed callbacks', async () => {
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    let callback: (event: unknown) => void = () => {}
    const sent: SwfCommand[] = []
    Object.assign(window, {
      arcadiaSwf: {
        create: async () => {},
        send: async (c: SwfCommand) => {
          sent.push(c)
        },
        bounds: async () => {},
        dispose: async () => {},
        onEvent: (fn: typeof callback) => {
          callback = fn
          return () => {}
        },
      },
    })
    const data = new ArrayBuffer(8)
    new Uint8Array(data).set([70, 87, 83, 9, 8, 0, 0, 0])
    const events = vi.fn()
    const player = createSwfPlayer(document.createElement('div'), events)
    const loading = player.load({ container: data, movie: data })
    await vi.waitFor(() => expect(sent.length).toBe(1))
    const owner = sent[0]!
    const ready = { v: 1, instance: owner.instance, task: owner.task, seq: 1, type: 'ready', states: ['待机'] }
    callback({ ...ready, instance: 'attacker' })
    callback({ ...ready, task: 999 })
    callback({ ...ready, states: ['execute'] })
    expect(events).not.toHaveBeenCalled()
    callback(ready)
    await expect(loading).resolves.toEqual(['待机'])
    callback(ready)
    expect(events).toHaveBeenCalledOnce()
    player.dispose()
    callback({ ...ready, seq: 2, type: 'hit', state: '待机' })
    expect(events).toHaveBeenCalledOnce()
    delete (window as Window & { arcadiaSwf?: unknown }).arcadiaSwf
  })
})

it('publishes identical visibility and deduplicated bounds from configure and animation frames', async () => {
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    }),
  )
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  let hidden = false
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
  let callback: (event: unknown) => void = () => {}
  const bounds = vi.fn(async () => {})
  Object.assign(window, {
    arcadiaSwf: {
      create: async () => {},
      dispose: async () => {},
      bounds,
      onEvent: (handler: typeof callback) => {
        callback = handler
        return () => {}
      },
      send: async (command: SwfCommand) => {
        if (command.type === 'load') callback({ ...command, type: 'ready', states: ['待机'] })
      },
    },
  })
  const element = document.createElement('div')
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ x: 1, y: 2, width: 100, height: 50 } as DOMRect)
  const player = createSwfPlayer(element, () => {})
  const data = new Uint8Array([70, 87, 83, 9, 8, 0, 0, 0]).buffer
  await player.load({ container: data, movie: data })
  expect(bounds).toHaveBeenCalledTimes(1)
  player.configure({ reverse: false, width: 100, height: 50 })
  expect(bounds).toHaveBeenCalledTimes(1)
  hidden = true
  player.configure({ reverse: false, width: 100, height: 50 })
  expect(bounds).toHaveBeenCalledTimes(2)
  expect(bounds.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ visible: false }))
  frames.shift()?.(0)
  expect(bounds).toHaveBeenCalledTimes(2)
  hidden = false
  frames.shift()?.(1)
  expect(bounds).toHaveBeenCalledTimes(3)
  expect(bounds.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ visible: true }))
  player.configure({ reverse: true, width: 100, height: 50 })
  expect(bounds).toHaveBeenCalledTimes(3)
  player.dispose()
})
