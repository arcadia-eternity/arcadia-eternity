import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

type HashInput = string | Uint8Array

export function sha256Bytes(...parts: HashInput[]): Uint8Array {
  const hash = sha256.create()
  for (const part of parts) hash.update(typeof part === 'string' ? utf8ToBytes(part) : part)
  return hash.digest()
}

export function sha256Hex(...parts: HashInput[]): string {
  return bytesToHex(sha256Bytes(...parts))
}

export async function sha256StreamHex(chunks: AsyncIterable<HashInput>): Promise<string> {
  const hash = sha256.create()
  for await (const chunk of chunks) hash.update(typeof chunk === 'string' ? utf8ToBytes(chunk) : chunk)
  return bytesToHex(hash.digest())
}
