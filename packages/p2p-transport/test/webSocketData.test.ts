import { describe, expect, it } from 'vitest'
import { webSocketText } from '../src/webSocketData'

describe('WebSocket message decoding', () => {
  const text = JSON.stringify({ type: 'battle', payload: '中文消息' })
  const buffer = Buffer.from(text)
  it('decodes the default Buffer representation', () => {
    expect(webSocketText(buffer)).toBe(text)
  })
  it('decodes ArrayBuffer messages without object stringification', () => {
    const data = new Uint8Array(buffer).buffer
    expect(webSocketText(data)).toBe(text)
  })
  it('joins fragments before decoding UTF-8, including split multibyte characters', () => {
    const split = buffer.indexOf(Buffer.from('中文')) + 1
    expect(JSON.parse(webSocketText([buffer.subarray(0, split), buffer.subarray(split)]))).toEqual(JSON.parse(text))
  })
})
