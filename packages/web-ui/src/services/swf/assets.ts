import { sha256Hex } from '@arcadia-eternity/const'
import { readBundledSwfContainer, readBundledRuffleFile } from '../resourceTransport'
import { startMediaPreload } from '../mediaPreloadProgress'
import { withPreloadBackoff } from '../mediaPreloadRetry'
import { waitForMediaPriority } from '../mediaPriority'
import { SharedReads } from '../sharedRead'

const runtimeFiles = Object.keys(__RUFFLE_RUNTIME_SHA256__)
const reloadFiles = new Set<string>()

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
          : await readBundledRuffleFile(name, readSignal, reloadFiles.has(name) ? 'reload' : 'default')
      readSignal.throwIfAborted()
      if (name !== 'container' && sha256Hex(bytes) !== __RUFFLE_RUNTIME_SHA256__[name]) {
        reloadFiles.add(name)
        throw new Error(`Bundled Ruffle file ${name} does not match this client build`)
      }
      if (name !== 'container' && runtimeBytes + bytes.byteLength > 64 * 1024 * 1024)
        throw new Error('Bundled runtime exceeds limit')
      const buffer = bytes.slice().buffer
      if (name !== 'container') runtimeBytes += buffer.byteLength
      ready.set(name, buffer)
      reloadFiles.delete(name)
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
  // The adapter posts a structured clone to each player without transferring these retained buffers.
  return Object.fromEntries(
    await Promise.all(runtimeFiles.map(async name => [name, await readPlayerFile(name, signal)] as const)),
  )
}

export async function preloadSwfPlayer(signal: AbortSignal) {
  await withPreloadBackoff(signal, async () => {
    await waitForMediaPriority('deferred', signal)
    if (signal.aborted) return 0
    const files = ['container', ...(hasNativePlayer() ? [] : runtimeFiles)].filter(name => !ready.has(name))
    if (!files.length) return 0
    const batch = startMediaPreload('动画播放器', files.length, signal)
    try {
      await Promise.all(
        files.map((name, index) =>
          batch.run(index, name === 'container' ? '动画容器' : name, () => readPlayerFile(name, signal)),
        ),
      )
      return batch.failed
    } finally {
      batch.finish()
    }
  })
}
