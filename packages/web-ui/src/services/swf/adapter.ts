import { readResourceBytes } from '../resourceTransport'
import playerDocument from '../../../public/swf-player.html?raw'
import {
  validateSwfBytes,
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
  bounds(options: {
    instance: string
    x: number
    y: number
    width: number
    height: number
    visible: boolean
  }): Promise<unknown>
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

// Native views sit above the owner DOM. Hide them for explicit modal surfaces;
// ordinary battle HUD elements intentionally overlap sprites.
function visuallyVisible(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse' ||
      (style.opacity !== '' && Number(style.opacity) === 0)
    )
      return false
  }
  return true
}
function nativeVisible(element: HTMLElement, rect: DOMRect): boolean {
  if (document.hidden || rect.width <= 0 || rect.height <= 0 || !visuallyVisible(element)) return false
  return !Array.from(
    document.querySelectorAll('.battle-result, .el-overlay, [role="dialog"], [aria-modal="true"], dialog[open]'),
  ).some(surface => {
    // The result panel lives inside a full-screen backdrop without a modal role.
    const blocker = surface.matches('.battle-result') ? (surface.parentElement ?? surface) : surface
    if (!visuallyVisible(surface) || !visuallyVisible(blocker)) return false
    const r = blocker.getBoundingClientRect()
    return (
      r.width > 0 &&
      r.height > 0 &&
      r.x < rect.x + rect.width &&
      r.x + r.width > rect.x &&
      r.y < rect.y + rect.height &&
      r.y + r.height > rect.y
    )
  })
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
  const publishNativeBounds = () => {
    if (!desktop || !nativeReady || disposed) return
    const r = element.getBoundingClientRect()
    const bounds = {
      instance,
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      visible: nativeVisible(element, r),
    }
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
      if (timer) clearTimeout(timer)
      resolve?.(value.states)
      resolve = undefined
      reject = undefined
    }
    if (value.type === 'complete') current = '待机'
    if (value.type === 'error') fail(value.message, false)
    onEvent(value)
  }
  const unsubscribe = desktop?.onEvent(receive)
  const command = (value: Omit<SwfCommand, 'v' | 'instance' | 'task' | 'seq'>) =>
    ({ v: 1 as const, instance, task, seq: ++seq, ...value }) as SwfCommand
  const send = (value: SwfCommand) => {
    if (desktop) void desktop.send(value).catch(() => fail('Desktop playback unavailable'))
    else port?.postMessage(value)
  }
  return {
    async load(bytes: SwfBytes) {
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
        fail(error instanceof Error ? error.message : 'Playback failed')
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
      void desktop?.dispose({ instance }).catch(() => {})
    },
  }
}
