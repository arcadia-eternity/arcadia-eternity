import { sha256Hex } from '@arcadia-eternity/const'
import { readBundledSwfContainer, readResourceBytes } from '../resourceTransport'
import { startMediaPreload } from '../mediaPreloadProgress'
import { SharedReads } from '../sharedRead'

const runtimeFiles = [
  'ruffle.js',
  'core.ruffle.16d61072ac7fdc4d5013.js',
  'core.ruffle.994eeef0a471a88cd0e3.js',
  '878d548199cddef07035.wasm',
  '172de42e6619eac8f371.wasm',
]

// Only installed player code enters this cache. Content packages and persistent media caches cannot populate it.
const pending = new SharedReads<ArrayBuffer>()
const ready = new Map<string, ArrayBuffer>()
let runtimeBytes = 0
async function readPlayerFile(name: string, signal: AbortSignal) {
  signal.throwIfAborted()
  const hit = ready.get(name)
  if (hit) return hit
  return pending
    .get(name, name, async readSignal => {
      const bytes =
        name === 'container'
          ? await readBundledSwfContainer(readSignal)
          : await readResourceBytes(new URL(`${import.meta.env.BASE_URL}ruffle/${name}`, location.href).href, {
              signal: readSignal,
              maxBytes: 32 * 1024 * 1024,
            })
      readSignal.throwIfAborted()
      if (name === 'ruffle.js' && sha256Hex(bytes) !== import.meta.env.VITE_RUFFLE_ENTRY_SHA256)
        throw new Error('Bundled Ruffle entry does not match this client build')
      if (name !== 'container' && runtimeBytes + bytes.byteLength > 64 * 1024 * 1024)
        throw new Error('Bundled runtime exceeds limit')
      const buffer = bytes.slice().buffer
      if (name !== 'container') runtimeBytes += buffer.byteLength
      ready.set(name, buffer)
      return buffer
    })
    .join(signal)
}

export async function prepareSwfEntry() {
  if (!hasNativePlayer()) await readPlayerFile('ruffle.js', new AbortController().signal)
}

const hasNativePlayer = () => 'arcadiaSwf' in window && !!window.arcadiaSwf

export async function readSwfContainer(signal: AbortSignal) {
  return (await readPlayerFile('container', signal)).slice(0)
}

export async function readSwfRuntime(signal: AbortSignal) {
  const runtime: Record<string, ArrayBuffer> = {}
  // The adapter posts a structured clone to each player without transferring these retained buffers.
  for (const name of runtimeFiles) runtime[name] = await readPlayerFile(name, signal)
  return runtime
}

export async function preloadSwfPlayer(signal: AbortSignal) {
  const files = ['container', ...(hasNativePlayer() ? [] : runtimeFiles)].filter(name => !ready.has(name))
  if (!files.length || signal.aborted) return
  const batch = startMediaPreload('动画播放器', files.length, signal)
  try {
    for (const [index, name] of files.entries()) {
      if (signal.aborted) break
      await batch.run(index, name === 'container' ? '动画容器' : name, () => readPlayerFile(name, signal))
    }
  } finally {
    batch.finish()
  }
}
