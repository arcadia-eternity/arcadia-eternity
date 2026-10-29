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
