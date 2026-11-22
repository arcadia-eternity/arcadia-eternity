import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export function installedRuffleBytes(url: string) {
  const name = new URL(url).pathname.split('/').pop()!
  return new Uint8Array(readFileSync(join(import.meta.dirname, '../../../../node_modules/@ruffle-rs/ruffle', name)))
}
