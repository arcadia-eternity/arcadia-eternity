/** Main-process paint broker. No player-provided bytes enter this channel. */
export const FRAME_LIMITS = { dimension: 2048, pixels: 2097152, bytes: 8 * 1024 * 1024, fps: 24 }
export function validFrameSize(width, height) {
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= FRAME_LIMITS.dimension &&
    height <= FRAME_LIMITS.dimension &&
    width * height <= FRAME_LIMITS.pixels
  )
}
function union(a, b) {
  if (!a) return b
  if (!b) return a
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y)
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  }
}
// All-zero pixels are transparent in every NativeImage bitmap channel ordering.
// Retaining every nonzero pixel is conservative even for transparent colored RGB.
// Raw pixels stay in main; the only output remains a bounded PNG.
export function nonzeroBounds(bitmap, width, height) {
  if (bitmap.byteLength !== width * height * 4 || bitmap.byteOffset % 4 !== 0) return { x: 0, y: 0, width, height }
  const pixels = new Uint32Array(bitmap.buffer, bitmap.byteOffset, bitmap.byteLength / 4)
  let left = width,
    top = height,
    right = -1,
    bottom = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[y * width + x] !== 0) {
        left = Math.min(left, x)
        right = Math.max(right, x)
        top = Math.min(top, y)
        bottom = y
      }
    }
  }
  return right < 0 ? undefined : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
}
function intersect(a, b) {
  const x = Math.max(a.x, b.x),
    y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width),
    bottom = Math.min(a.y + a.height, b.y + b.height)
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : undefined
}
export function createFrameBroker({
  instance,
  send,
  fail,
  now = () => performance.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let task = 0,
    width = 1,
    height = 1,
    sequence = 0,
    enabled = false,
    dead = false,
    latest,
    previousContent,
    dirty,
    full = true,
    pending,
    timer,
    ackDeadline,
    lastSent = -Infinity
  const metrics = { paints: 0, frames: 0, bytes: 0, encodingMs: 0, maxEncodingMs: 0, coalesced: 0 }
  function clearQueue() {
    clearTimer(timer)
    timer = undefined
    latest = undefined
    dirty = undefined
  }
  function clearAckDeadline() {
    clearTimer(ackDeadline)
    ackDeadline = undefined
  }
  function shutdown() {
    dead = true
    enabled = false
    pending = undefined
    clearAckDeadline()
    clearQueue()
  }
  function flush() {
    timer = undefined
    if (dead || !enabled || pending || !latest || !dirty) return
    const delay = 1000 / FRAME_LIMITS.fps - (now() - lastSent)
    if (delay > 0) {
      timer = setTimer(flush, Math.ceil(delay))
      return
    }
    const image = latest,
      changed = dirty
    latest = undefined
    dirty = undefined
    try {
      const started = now()
      const currentContent = image.toBitmap
        ? nonzeroBounds(image.toBitmap(), width, height)
        : { x: 0, y: 0, width, height }
      const contentChange = union(previousContent, currentContent)
      previousContent = currentContent
      const rect = full ? { x: 0, y: 0, width, height } : contentChange && intersect(changed, contentChange)
      if (!rect) return
      const png = image.crop(rect).toPNG()
      const duration = now() - started
      metrics.encodingMs += duration
      metrics.maxEncodingMs = Math.max(metrics.maxEncodingMs, duration)
      if (png.byteLength > FRAME_LIMITS.bytes) throw new Error('SWF paint exceeds frame byte limit')
      pending = { task, frame: ++sequence }
      const fence = pending
      ackDeadline = setTimer(() => {
        ackDeadline = undefined
        if (dead || pending !== fence) return
        shutdown()
        fail('SWF frame acknowledgment timed out')
      }, 5000)
      full = false
      lastSent = now()
      metrics.frames++
      metrics.bytes += png.byteLength
      send({
        v: 1,
        instance,
        task,
        frame: sequence,
        canvasWidth: width,
        canvasHeight: height,
        ...rect,
        png: new Uint8Array(png),
      })
    } catch {
      shutdown()
      fail('SWF paint encoding failed')
    }
  }
  return {
    reset(nextTask) {
      task = nextTask
      enabled = false
      pending = undefined
      clearAckDeadline()
      full = true
      previousContent = undefined
      clearQueue()
    },
    resize(nextWidth, nextHeight) {
      if (!validFrameSize(nextWidth, nextHeight)) throw new Error('Invalid SWF frame size')
      if (nextWidth === width && nextHeight === height) return
      width = nextWidth
      height = nextHeight
      full = true
      previousContent = undefined
      // Preserve the current ACK fence across a viewport resize: at most one
      // encoded frame may be decoding in the owner at any time.
      clearQueue()
    },
    ready() {
      if (!dead && task > 0) {
        enabled = true
        full = true
      }
    },
    paint(rect, image) {
      if (dead || !enabled || task <= 0) return
      const size = image.getSize()
      if (size.width !== width || size.height !== height) return
      const x = Math.max(0, Math.floor(rect.x)),
        y = Math.max(0, Math.floor(rect.y))
      const right = Math.min(width, Math.ceil(rect.x + rect.width)),
        bottom = Math.min(height, Math.ceil(rect.y + rect.height))
      if (right <= x || bottom <= y) return
      metrics.paints++
      if (latest) metrics.coalesced++
      latest = image
      dirty = union(dirty, { x, y, width: right - x, height: bottom - y })
      if (!pending && timer === undefined) flush()
    },
    ack(value) {
      if (
        dead ||
        !pending ||
        value?.instance !== instance ||
        value.task !== pending.task ||
        value.frame !== pending.frame
      )
        return
      pending = undefined
      clearAckDeadline()
      flush()
    },
    dispose: shutdown,
    inspect() {
      return { ...metrics, task, enabled, pending: pending ? 1 : 0, queued: latest ? 1 : 0, width, height }
    },
  }
}
