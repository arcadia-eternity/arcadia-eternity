#!/usr/bin/env node
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { readContentSources, assembleContent } from './lib/content.mjs'

const args = process.argv.slice(2)
if (args.length && (args.length !== 1 || args[0] !== '--check'))
  throw new Error('Usage: node scripts/build-content.mjs [--check]')
const root = resolve('.')
const sources = await readContentSources(root)
const content = assembleContent(sources)
if (!args.includes('--check')) {
  const directory = join(root, 'dist')
  await mkdir(directory, { recursive: true })
  const temporary = join(directory, `content.${process.pid}.tmp`)
  try {
    await writeFile(temporary, JSON.stringify(content, null, 2) + '\n', { flag: 'wx' })
    await rename(temporary, join(directory, 'content.json'))
  } finally {
    await rm(temporary, { force: true })
  }
}
console.log(
  `${args.includes('--check') ? 'Checked' : 'Built'} ${sources.length} data files: ${Object.entries(content.data)
    .map(([kind, records]) => `${kind}=${records.length}`)
    .join(', ')}`,
)
