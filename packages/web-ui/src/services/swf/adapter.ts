import { readResourceBytes } from '../resourceTransport'
import playerDocument from '../../../public/swf-player.html?raw'
import {
  validateSwfBytes,
  validSwfFrame,
  validSwfFrameIdentity,
  type SwfFrame,
  type SwfFrameAck,
  validSwfEvent,
  SWF_STATES,
  type SwfBounds,
  type SwfBytes,
  type SwfCommand,
  type SwfEventHandler,
  type SwfPlayer,
} from './protocol'
const runtimeFiles = [
  'ruffle.js',
  'core.ruffle.51d81af79f566b8c93f1.js',
  'core.ruffle.8da0ccba5a3edadea24d.js',
  'dcba28a55c2ebf0c3400.wasm',
  'b87f447eb5eff39fdaec.wasm',
]
interface DesktopBridge {
  create(options: { instance: string }): Promise<unknown>
  send(command: SwfCommand): Promise<unknown>
  bounds(options: { instance: string; width: number; height: number }): Promise<unknown>
  onFrame(callback: (value: unknown) => void): () => void
  ackFrame(value: SwfFrameAck): void
  dispose(options: { instance: string }): Promise<unknown>
  onEvent(callback: (value: unknown) => void): () => void
}
/** Runtime files are application code, never a content-provided URL or CDN fallback. */
async function readRuntime(signal: AbortSignal): Promise<Record<string, ArrayBuffer>> {
  const runtime: Record<string, ArrayBuffer> = {}
  let size = 0
  for (const name of runtimeFiles) {
    const bytes = await readResourceBytes(new URL(`${import.meta.env.BASE_URL}ruffle/${name}`, location.href).href, {
      signal,
      maxBytes: 32 * 1024 * 1024,
    })
    size += bytes.byteLength
    if (size > 64 * 1024 * 1024) throw new Error('Bundled runtime exceeds limit')
    runtime[name] = bytes.slice().buffer as ArrayBuffer
  }
  return runtime
}

export function createSwfPlayer(element: HTMLElement, onEvent: SwfEventHandler): SwfPlayer {
  const instance = crypto.randomUUID()
  let task = 0,
    seq = 0,
    incoming = 0,
    disposed = false,
    current = '待机',
    frame: HTMLIFrameElement | undefined,
    port: MessagePort | undefined,
    timer: ReturnType<typeof setTimeout> | undefined,
    resolve: ((states: string[]) => void) | undefined,
    reject: ((error: Error) => void) | undefined,
    received = 0,
    epoch = Date.now()
  let loading: AbortController | undefined
  let nativeCreated: Promise<unknown> | undefined
  let nativeReady = false
  let nativeLoaded = false
  let pendingConfiguration: SwfBounds | undefined
  let boundsFrame: number | undefined
  let lastBounds = ''
  let canvas: HTMLCanvasElement | undefined
  let context: CanvasRenderingContext2D | undefined
  let pendingReady: string[] | undefined
  let paintedTask = 0
  let lastFrame = 0
  let decoding = false
  let pendingFrame: SwfFrame | undefined
  const acknowledgements = new Set<string>()
  const acknowledge = (value: SwfFrameAck) => {
    const key = `${value.task}:${value.frame}`
    if (acknowledgements.has(key)) return
    acknowledgements.add(key)
    if (acknowledgements.size > 64) acknowledgements.delete(acknowledgements.values().next().value!)
    if (typeof desktop?.ackFrame === 'function') desktop.ackFrame({ instance, task: value.task, frame: value.frame })
  }
  const finishReady = () => {
    if (!pendingReady || (desktop && paintedTask !== task)) return
    if (timer) clearTimeout(timer)
    resolve?.(pendingReady)
    resolve = undefined
    reject = undefined
    pendingReady = undefined
  }
  const publishNativeBounds = () => {
    if (!desktop || !nativeReady || disposed) return
    const bounds = { instance, width: element.clientWidth || 1, height: element.clientHeight || 1 }
    const key = JSON.stringify(bounds)
    if (lastBounds !== key) {
      lastBounds = key
      void desktop.bounds(bounds).catch(() => fail('Desktop playback bounds unavailable'))
    }
  }
  const updateNativeBounds = () => {
    if (!desktop || !nativeReady || disposed) return
    publishNativeBounds()
    boundsFrame = requestAnimationFrame(updateNativeBounds)
  }
  const desktop = (window as Window & { arcadiaSwf?: DesktopBridge }).arcadiaSwf
  const cleanup = () => {
    loading?.abort()
    if (timer) clearTimeout(timer)
    port?.close()
    port = undefined
    frame?.remove()
    frame = undefined
    canvas?.remove()
    canvas = undefined
    context = undefined
    pendingReady = undefined
    paintedTask = 0
    lastFrame = 0
    if (pendingFrame) acknowledge(pendingFrame)
    pendingFrame = undefined
  }
  const fail = (message: string, notify = true) => {
    if (disposed) return
    if (notify) onEvent({ v: 1, instance, task, seq: ++incoming, type: 'error', message: message.slice(0, 240) })
    if (boundsFrame !== undefined) cancelAnimationFrame(boundsFrame)
    boundsFrame = undefined
    void desktop?.dispose({ instance }).catch(() => {})
    nativeCreated = undefined
    nativeReady = false
    nativeLoaded = false
    lastBounds = ''
    task++
    reject?.(new Error(message))
    resolve = undefined
    reject = undefined
    cleanup()
  }
  const receive = (value: unknown) => {
    if (
      disposed ||
      !validSwfEvent(value) ||
      value.instance !== instance ||
      value.task !== task ||
      value.seq <= incoming
    )
      return
    if (Date.now() - epoch > 1000) {
      epoch = Date.now()
      received = 0
    }
    if (++received > 60) {
      fail('Playback callback rate exceeded')
      return
    }
    incoming = value.seq
    if (value.type === 'ready') {
      nativeLoaded = true
      if (desktop && pendingConfiguration) {
        send({ ...command({ type: 'configure' }), bounds: pendingConfiguration } as SwfCommand)
        pendingConfiguration = undefined
      }
      pendingReady = value.states
      finishReady()
    }
    if (value.type === 'complete') current = '待机'
    if (value.type === 'error') fail(value.message, false)
    onEvent(value)
  }
  const drawFrame = async (value: SwfFrame) => {
    decoding = true
    let bitmap: ImageBitmap | undefined
    const target = canvas
    try {
      bitmap = await createImageBitmap(new Blob([value.png.slice().buffer as ArrayBuffer], { type: 'image/png' }))
      if (disposed || value.task !== task || target !== canvas || !canvas || !context) return
      if (bitmap.width !== value.width || bitmap.height !== value.height)
        throw new Error('Invalid decoded frame dimensions')
      const resized = canvas.width !== value.canvasWidth || canvas.height !== value.canvasHeight
      if (
        (paintedTask !== task || resized) &&
        (value.x !== 0 || value.y !== 0 || value.width !== value.canvasWidth || value.height !== value.canvasHeight)
      )
        throw new Error('Desktop playback requires a full initial frame')
      if (resized) {
        canvas.width = value.canvasWidth
        canvas.height = value.canvasHeight
      }
      context.clearRect(value.x, value.y, value.width, value.height)
      context.drawImage(bitmap, value.x, value.y)
      paintedTask = task
      finishReady()
    } catch {
      if (!disposed && value.task === task && target === canvas) fail('Desktop playback frame unavailable')
    } finally {
      bitmap?.close()
      acknowledge(value)
      decoding = false
      const next = pendingFrame
      pendingFrame = undefined
      if (next) {
        if (!disposed && next.task === task) void drawFrame(next)
        else acknowledge(next)
      }
    }
  }
  const receiveFrame = (value: unknown) => {
    if (!validSwfFrameIdentity(value) || value.instance !== instance) return
    if (disposed || value.task !== task || value.frame <= lastFrame) {
      acknowledge(value)
      return
    }
    if (!validSwfFrame(value)) {
      acknowledge(value)
      fail('Invalid desktop playback frame')
      return
    }
    lastFrame = value.frame
    if (decoding) {
      if (pendingFrame) acknowledge(pendingFrame)
      pendingFrame = value
    } else void drawFrame(value)
  }
  const unsubscribe = typeof desktop?.onEvent === 'function' ? desktop.onEvent(receive) : undefined
  const unsubscribeFrames = typeof desktop?.onFrame === 'function' ? desktop.onFrame(receiveFrame) : undefined
  const command = (value: Omit<SwfCommand, 'v' | 'instance' | 'task' | 'seq'>) =>
    ({ v: 1 as const, instance, task, seq: ++seq, ...value }) as SwfCommand
  const send = (value: SwfCommand) => {
    if (desktop) void desktop.send(value).catch(() => fail('Desktop playback unavailable'))
    else port?.postMessage(value)
  }
  return {
    async load(bytes: SwfBytes) {
      if (disposed) throw new Error('Playback disposed')
      await validateSwfBytes(bytes)
      reject?.(new Error('Playback replaced'))
      cleanup()
      task++
      incoming = 0
      const loadingTask = task
      nativeLoaded = false
      loading = new AbortController()
      const ready = new Promise<string[]>((yes, no) => {
        resolve = yes
        reject = no
        timer = setTimeout(() => fail('Animation loading timed out'), 12000)
      })
      void ready.catch(() => {})
      try {
        const runtime = desktop ? undefined : await readRuntime(loading.signal)
        if (disposed || loadingTask !== task) throw new Error('Playback replaced')
        const load = { ...command({ type: 'load' }), bytes, runtime } as SwfCommand
        if (desktop) {
          if (
            typeof desktop.onFrame !== 'function' ||
            typeof desktop.ackFrame !== 'function' ||
            typeof createImageBitmap !== 'function'
          )
            throw new Error('Desktop frame playback unavailable')
          canvas = document.createElement('canvas')
          canvas.dataset.swfPlayer = instance
          canvas.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none;background:transparent'
          context = canvas.getContext('2d') ?? undefined
          if (!context) throw new Error('Desktop canvas playback unavailable')
          element.append(canvas)
          nativeCreated ??= desktop.create({ instance })
          await nativeCreated
          if (disposed || loadingTask !== task) throw new Error('Playback replaced')
          nativeReady = true
          if (boundsFrame === undefined) updateNativeBounds()
          send(load)
        } else {
          frame = document.createElement('iframe')
          frame.setAttribute('sandbox', 'allow-scripts')
          frame.setAttribute(
            'allow',
            "autoplay *; camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; fullscreen 'none'",
          )
          frame.referrerPolicy = 'no-referrer'
          frame.title = '精灵动画'
          frame.style.cssText = 'border:0;width:100%;height:100%;pointer-events:none;background:transparent'
          frame.srcdoc = playerDocument
          const child = frame
          let connected = false
          child.onload = () => {
            if (connected) {
              fail('Playback document navigated')
              return
            }
            connected = true
            if (disposed || frame !== child || loadingTask !== task) return
            const channel = new MessageChannel()
            port = channel.port1
            port.onmessage = e => receive(e.data)
            port.start()
            child.contentWindow?.postMessage({ type: 'arcadia-swf-connect' }, '*', [channel.port2])
            port.postMessage(load)
          }
          element.append(child)
        }
      } catch (error) {
        if (!disposed && loadingTask === task) fail(error instanceof Error ? error.message : 'Playback failed')
      }
      return ready
    },
    async setState(state: string) {
      if (disposed || !SWF_STATES.includes(state as (typeof SWF_STATES)[number]))
        throw new Error('Invalid animation state')
      current = state
      send({ ...command({ type: 'play' }), state } as SwfCommand)
    },
    getState: () => current,
    configure(bounds: SwfBounds) {
      if (disposed) return
      if (desktop && !nativeLoaded) {
        pendingConfiguration = bounds
        return
      }
      send({ ...command({ type: 'configure' }), bounds } as SwfCommand)
      publishNativeBounds()
    },
    stop() {
      current = '待机'
      if (!disposed) send(command({ type: 'stop' }))
    },
    dispose() {
      if (disposed) return
      send(command({ type: 'dispose' }))
      disposed = true
      if (boundsFrame !== undefined) cancelAnimationFrame(boundsFrame)
      reject?.(new Error('Playback disposed'))
      cleanup()
      unsubscribe?.()
      unsubscribeFrames?.()
      void desktop?.dispose({ instance }).catch(() => {})
    },
  }
}
