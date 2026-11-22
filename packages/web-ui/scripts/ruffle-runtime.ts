import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

// These are the entry and both core/WASM pairs used by swf-player.html.
const files = [
  'ruffle.js',
  'core.ruffle.16d61072ac7fdc4d5013.js',
  'core.ruffle.994eeef0a471a88cd0e3.js',
  '878d548199cddef07035.wasm',
  '172de42e6619eac8f371.wasm',
]

export function ruffleRuntimeHashes() {
  return Object.fromEntries(
    files.map(name => {
      const bytes = readFileSync(new URL(`../node_modules/@ruffle-rs/ruffle/${name}`, import.meta.url))
      return [name, createHash('sha256').update(bytes).digest('hex')]
    }),
  )
}
