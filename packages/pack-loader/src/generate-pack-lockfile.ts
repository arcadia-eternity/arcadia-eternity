import { resolve, dirname } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { stringify } from 'yaml'
import { generatePackLockfileFromEntry } from './lockfile.js'

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter(arg => arg !== '--')
  const [entryArg, outputArg] = args
  if (!entryArg) {
    console.error('Usage: pnpm --filter @arcadia-eternity/pack-loader run generate:lockfile -- <pack.json> [output]')
    process.exit(1)
  }

  const entry = resolve(entryArg)
  const output = outputArg ? resolve(outputArg) : resolve(dirname(entry), 'pack-lock.yaml')
  const lockfile = await generatePackLockfileFromEntry(entry)
  await writeFile(output, stringify(lockfile), 'utf8')
  console.log(`Generated lockfile: ${output}`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
