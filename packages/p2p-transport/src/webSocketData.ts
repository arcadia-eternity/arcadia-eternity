import type { RawData } from 'ws'

/** ws may deliver a Buffer, an ArrayBuffer or a fragmented buffer list. */
export function webSocketText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  return Buffer.isBuffer(data) ? data.toString('utf8') : Buffer.from(data).toString('utf8')
}
