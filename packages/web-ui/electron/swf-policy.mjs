export const PLAYER_URL = 'arcadia-swf://player/swf-player.html'
export const STATES = [
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
export function validInstance(x) {
  return typeof x === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(x)
}
export function validEnvelope(x) {
  return (
    x &&
    typeof x === 'object' &&
    !Array.isArray(x) &&
    x.v === 1 &&
    validInstance(x.instance) &&
    Number.isSafeInteger(x.task) &&
    x.task > 0 &&
    Number.isSafeInteger(x.seq) &&
    x.seq > 0 &&
    Object.keys(x).length <= 9
  )
}
export function validBytes(x) {
  if (!(x instanceof ArrayBuffer) || x.byteLength < 8 || x.byteLength > 16 * 1024 * 1024) return false
  const a = new Uint8Array(x, 0, 8)
  return (
    ['FWS', 'CWS'].includes(String.fromCharCode(...a.slice(0, 3))) &&
    new DataView(x).getUint32(4, true) <= 64 * 1024 * 1024
  )
}
export function validBounds(x) {
  return (
    x &&
    ['x', 'y', 'width', 'height'].every(
      k => Number.isFinite(x[k]) && x[k] >= (k === 'x' || k === 'y' ? -10000 : 0) && x[k] <= 10000,
    ) &&
    typeof x.visible === 'boolean'
  )
}
export function validCommand(x) {
  if (!validEnvelope(x)) return false
  if (x.type === 'load') {
    if (!validBytes(x.bytes?.container) || !validBytes(x.bytes?.movie)) return false
    if (x.runtime === undefined) return true
    if (!x.runtime || typeof x.runtime !== 'object' || Array.isArray(x.runtime)) return false
    let total = 0
    const entries = Object.entries(x.runtime)
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
  if (x.type === 'play') return STATES.includes(x.state)
  if (x.type === 'configure')
    return (
      typeof x.bounds?.reverse === 'boolean' &&
      ['width', 'height'].every(k => Number.isFinite(x.bounds[k]) && x.bounds[k] > 0 && x.bounds[k] <= 4096)
    )
  return x.type === 'stop' || x.type === 'dispose'
}
export function validEvent(x) {
  if (!validEnvelope(x)) return false
  if (x.type === 'ready')
    return Array.isArray(x.states) && x.states.length <= STATES.length && x.states.every(s => STATES.includes(s))
  if (x.type === 'error') return typeof x.message === 'string' && x.message.length <= 240
  return (
    ['hit', 'complete'].includes(x.type) &&
    STATES.includes(x.state) &&
    (x.duration === undefined || (Number.isFinite(x.duration) && x.duration >= 0 && x.duration <= 60000))
  )
}
export function rateGate(limit, now = Date.now) {
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
