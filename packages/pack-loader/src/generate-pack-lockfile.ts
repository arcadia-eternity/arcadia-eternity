import { resolve, dirname } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { stringify } from 'yaml'
import { generatePackLockfileFromEntry, type PackLockfileOptions } from './lockfile.js'

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter(arg => arg !== '--')
  const workspaceIndex = args.indexOf('--workspace')
  if (workspaceIndex !== -1 && !args[workspaceIndex + 1]) throw new Error('--workspace requires a value')
  const workspaceArg = workspaceIndex === -1 ? undefined : args[workspaceIndex + 1]
  const positional =
    workspaceIndex === -1 ? args : args.filter((_, index) => index !== workspaceIndex && index !== workspaceIndex + 1)
  const [entryArg, outputArg] = positional
  if (!entryArg) {
    console.error(
      'Usage: pnpm --filter @arcadia-eternity/pack-loader run generate:lockfile -- <pack.json> [output] [--workspace <package-name>#<entry>]',
    )
    process.exit(1)
  }

  const entry = resolve(entryArg)
  const output = outputArg ? resolve(outputArg) : resolve(dirname(entry), 'pack-lock.yaml')
  let options: PackLockfileOptions = {}
  if (workspaceArg) {
    const separator = workspaceArg.lastIndexOf('#')
    if (separator <= 0 || separator === workspaceArg.length - 1)
      throw new Error('--workspace must use <package-name>#<entry>')
    options = {
      workspaceSource: {
        packageName: workspaceArg.slice(0, separator),
        entry: workspaceArg.slice(separator + 1).replace(/\\/g, '/'),
      },
    }
  }
  const lockfile = await generatePackLockfileFromEntry(entry, '.', options)
  await writeFile(output, stringify(lockfile), 'utf8')
  console.log(`Generated lockfile: ${output}`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
