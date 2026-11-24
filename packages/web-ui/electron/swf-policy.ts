import { inspectMedia } from '../shared/media-formats.mjs'
import type { SwfBounds, SwfCommand, SwfEvent } from '../src/services/swf/protocol.ts'

export const PLAYER_URL = 'arcadia-swf://player/swf-player.html'
const STATES = [
  '待机',
  '物理攻击',
  '属性攻击',
  '特殊攻击',
  '被打',
  '被暴击',
  '胜利',
  '失败',
  '闪避',
  '必杀',
  '濒死',
  '个性出场',
  '合体攻击',
  '变身效果',
  '空',
]
export function validInstance(x: unknown): x is string {
  return typeof x === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(x)
}
function validEnvelope(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const x = value as Record<string, unknown>
  return (
    x.v === 1 &&
    validInstance(x.instance) &&
    typeof x.task === 'number' &&
    Number.isSafeInteger(x.task) &&
    x.task > 0 &&
    typeof x.seq === 'number' &&
    Number.isSafeInteger(x.seq) &&
    x.seq > 0 &&
    Object.keys(x).length <= 9
  )
}
function validBytes(x: unknown): x is ArrayBuffer {
  if (!(x instanceof ArrayBuffer)) return false
  try {
    inspectMedia('swf', new Uint8Array(x))
    return true
  } catch {
    return false
  }
}
export function validBounds(value: unknown): value is Pick<SwfBounds, 'width' | 'height'> {
  if (!value || typeof value !== 'object') return false
  const { width, height } = value as Partial<Record<'width' | 'height', unknown>>
  return (
    typeof width === 'number' &&
    typeof height === 'number' &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0 &&
    width <= 2048 &&
    height <= 2048 &&
    Math.round(width) * Math.round(height) <= 2097152
  )
}
export function validSwfRuntime(runtime: unknown): runtime is Record<string, ArrayBuffer> {
  if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime)) return false
  let total = 0
  const entries = Object.entries(runtime)
  if (entries.length < 1 || entries.length > 8) return false
  return entries.every(
    ([name, bytes]) =>
      /^[a-zA-Z0-9._-]+\.(js|wasm)$/.test(name) &&
      bytes instanceof ArrayBuffer &&
      bytes.byteLength > 0 &&
      bytes.byteLength <= 32 * 1024 * 1024 &&
      (total += bytes.byteLength) <= 64 * 1024 * 1024,
  )
}
export function validCommand(x: unknown): x is SwfCommand {
  if (!validEnvelope(x)) return false
  if (x.type === 'load') {
    const bytes = x.bytes as Partial<Record<'container' | 'movie', unknown>> | undefined
    if (!validBytes(bytes?.container) || !validBytes(bytes?.movie)) return false
    return x.runtime === undefined || validSwfRuntime(x.runtime)
  }
  if (x.type === 'play') return typeof x.state === 'string' && STATES.includes(x.state)
  if (x.type === 'configure') {
    const bounds = x.bounds as Partial<Record<keyof SwfBounds, unknown>> | undefined
    return (
      typeof bounds?.reverse === 'boolean' &&
      [bounds.width, bounds.height].every(n => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 4096)
    )
  }
  return x.type === 'stop' || x.type === 'dispose'
}
export function validEvent(x: unknown): x is SwfEvent {
  if (!validEnvelope(x)) return false
  if (x.type === 'ready')
    return Array.isArray(x.states) && x.states.length <= STATES.length && x.states.every(s => STATES.includes(s))
  if (x.type === 'error') return typeof x.message === 'string' && x.message.length <= 240
  return (
    (x.type === 'hit' || x.type === 'complete') &&
    typeof x.state === 'string' &&
    STATES.includes(x.state) &&
    (x.duration === undefined ||
      (typeof x.duration === 'number' && Number.isFinite(x.duration) && x.duration >= 0 && x.duration <= 60000))
  )
}
export function rateGate(limit: number, now = Date.now) {
  let start = now(),
    count = 0
  return () => {
    const time = now()
    if (time - start >= 1000) {
      start = time
      count = 0
    }
    return ++count <= limit
  }
}
