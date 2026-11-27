import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

export class WorkshopError extends Error {
  constructor(
    readonly code: string,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'WorkshopError'
  }
}
export function fail(code: string, message?: string): never {
  throw new WorkshopError(code, message)
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
export const utf8 = (value: string): Uint8Array<ArrayBuffer> => encoder.encode(value)
export function decodeUtf8(bytes: Uint8Array) {
  try {
    return decoder.decode(bytes)
  } catch {
    fail('WORKSHOP_ENCODING_INVALID')
  }
}

/** Signed metadata admits only JSON values with one canonical serialization. */
export function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 32) fail('WORKSHOP_METADATA_INVALID', 'Metadata nesting is too deep')
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) fail('WORKSHOP_METADATA_INVALID', 'Metadata numbers must be safe integers')
    return String(value)
  }
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item, depth + 1)).join(',')}]`
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.some(([, item]) => item === undefined))
      fail('WORKSHOP_METADATA_INVALID', 'Metadata fields cannot be undefined')
    return `{${entries
      .map(([key]) => key)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key], depth + 1)}`)
      .join(',')}}`
  }
  fail('WORKSHOP_METADATA_INVALID', 'Metadata contains a non-JSON value')
}

export function parseJsonBytes(bytes: Uint8Array, maxBytes: number): unknown {
  if (bytes.byteLength > maxBytes) fail('WORKSHOP_LIMIT')
  try {
    return JSON.parse(decodeUtf8(bytes))
  } catch (error) {
    if (error instanceof WorkshopError) throw error
    fail('WORKSHOP_METADATA_INVALID', 'Metadata is not JSON')
  }
}

export const sha256Hex = (bytes: Uint8Array) => bytesToHex(sha256(bytes))

export function toBase64(bytes: Uint8Array) {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(binary)
}
export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4) fail('WORKSHOP_ENCODING_INVALID')
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}
