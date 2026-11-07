/** Cosmetic playback only. Never feed these events into the battle protocol. */
export const SWF_VERSION = 1
export const SWF_MAX_BYTES = 16 * 1024 * 1024
export const SWF_STATES = [
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
] as const
export interface SwfBytes {
  container: ArrayBuffer
  movie: ArrayBuffer
}
export interface SwfBounds {
  reverse: boolean
  width: number
  height: number
}
export interface SwfEnvelope {
  v: 1
  instance: string
  task: number
  seq: number
}
export type SwfEvent = SwfEnvelope &
  (
    | { type: 'ready'; states: string[] }
    | { type: 'hit' | 'complete'; state: string; duration?: number }
    | { type: 'error'; message: string }
  )
export type SwfCommand = SwfEnvelope &
  (
    | { type: 'load'; bytes: SwfBytes; runtime?: Record<string, ArrayBuffer> }
    | { type: 'play'; state: string }
    | { type: 'configure'; bounds: SwfBounds }
    | { type: 'stop' | 'dispose' }
  )
/** Host-rendered dirty PNG; never emitted by the untrusted SWF page. */
export interface SwfFrame {
  v: 1
  instance: string
  task: number
  frame: number
  canvasWidth: number
  canvasHeight: number
  x: number
  y: number
  width: number
  height: number
  png: Uint8Array
}
export interface SwfFrameAck {
  instance: string
  task: number
  frame: number
}
export const SWF_FRAME_MAX_DIMENSION = 2048
export const SWF_FRAME_MAX_PIXELS = 2097152
export const SWF_FRAME_MAX_BYTES = 8 * 1024 * 1024
export function validSwfFrameIdentity(value: unknown): value is SwfFrameAck & Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const x = value as Record<string, unknown>
  return (
    typeof x.instance === 'string' &&
    /^[a-zA-Z0-9-]{1,80}$/.test(x.instance) &&
    Number.isSafeInteger(x.task) &&
    Number(x.task) > 0 &&
    Number.isSafeInteger(x.frame) &&
    Number(x.frame) > 0
  )
}
/** Preflight dimensions before invoking a browser image decoder. */
export function validSwfFrame(value: unknown): value is SwfFrame {
  if (!validSwfFrameIdentity(value) || value.v !== 1 || Object.keys(value).length !== 11) return false
  const x = value as unknown as SwfFrame
  if (
    ![x.canvasWidth, x.canvasHeight, x.width, x.height].every(
      n => Number.isSafeInteger(n) && n > 0 && n <= SWF_FRAME_MAX_DIMENSION,
    ) ||
    x.canvasWidth * x.canvasHeight > SWF_FRAME_MAX_PIXELS ||
    ![x.x, x.y].every(n => Number.isSafeInteger(n) && n >= 0) ||
    x.x + x.width > x.canvasWidth ||
    x.y + x.height > x.canvasHeight ||
    !(x.png instanceof Uint8Array) ||
    x.png.byteLength < 33 ||
    x.png.byteLength > SWF_FRAME_MAX_BYTES
  )
    return false
  const data = x.png
  if (
    ![137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => data[i] === n) ||
    ![73, 72, 68, 82].every((n, i) => data[i + 12] === n)
  )
    return false
  const header = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return header.getUint32(8) === 13 && header.getUint32(16) === x.width && header.getUint32(20) === x.height
}
export interface SwfPlayer {
  load(bytes: SwfBytes): Promise<string[]>
  setState(state: string): Promise<void>
  getState(): string
  configure(bounds: SwfBounds): void
  stop(): void
  dispose(): void
}
export type SwfEventHandler = (event: SwfEvent) => void
export function validEnvelope(value: unknown): value is SwfEnvelope & Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const x = value as Record<string, unknown>
  return (
    x.v === 1 &&
    typeof x.instance === 'string' &&
    /^[a-zA-Z0-9-]{1,80}$/.test(x.instance) &&
    Number.isSafeInteger(x.task) &&
    Number(x.task) > 0 &&
    Number.isSafeInteger(x.seq) &&
    Number(x.seq) > 0
  )
}
export function validSwfEvent(value: unknown): value is SwfEvent {
  if (!validEnvelope(value) || Object.keys(value).length > 9) return false
  if (value.type === 'ready')
    return (
      Array.isArray(value.states) &&
      value.states.length <= SWF_STATES.length &&
      value.states.every(x => SWF_STATES.includes(x))
    )
  if (value.type === 'error') return typeof value.message === 'string' && value.message.length <= 240
  return (
    (value.type === 'hit' || value.type === 'complete') &&
    SWF_STATES.includes(value.state as (typeof SWF_STATES)[number]) &&
    (value.duration === undefined ||
      (typeof value.duration === 'number' &&
        Number.isFinite(value.duration) &&
        value.duration >= 0 &&
        value.duration <= 60000))
  )
}
export function assertSwfBytes(bytes: SwfBytes): void {
  for (const data of [bytes.container, bytes.movie]) {
    if (!(data instanceof ArrayBuffer) || data.byteLength < 8 || data.byteLength > SWF_MAX_BYTES)
      throw new Error('SWF file exceeds playback limits')
    const header = new Uint8Array(data, 0, 8)
    if (!['FWS', 'CWS'].includes(String.fromCharCode(...header.slice(0, 3)))) throw new Error('Unsupported SWF format')
    if (new DataView(data).getUint32(4, true) > 64 * 1024 * 1024)
      throw new Error('SWF expanded size exceeds playback limits')
  }
}
/** Check received compressed bytes rather than trusting the SWF length header. */
export async function validateSwfBytes(bytes: SwfBytes): Promise<void> {
  assertSwfBytes(bytes)
  for (const data of [bytes.container, bytes.movie]) {
    const header = new Uint8Array(data, 0, 8)
    const expected = new DataView(data).getUint32(4, true)
    if (header[0] === 70) {
      if (data.byteLength !== expected) throw new Error('SWF size mismatch')
      continue
    }
    const reader = new Blob([data.slice(8)]).stream().pipeThrough(new DecompressionStream('deflate')).getReader()
    let size = 8
    try {
      for (;;) {
        const result = await reader.read()
        if (result.done) break
        size += result.value.byteLength
        if (size > expected || size > 64 * 1024 * 1024) throw new Error('SWF expanded size exceeds playback limits')
      }
    } finally {
      await reader.cancel()
    }
    if (size !== expected) throw new Error('SWF expanded size mismatch')
  }
}
