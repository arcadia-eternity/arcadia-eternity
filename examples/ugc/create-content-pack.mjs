#!/usr/bin/env node
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const sample = fileURLToPath(new URL('./slow/', import.meta.url))
const help = `Create an Arcadia npm content package from the slow-effect example.

Usage: node examples/ugc/create-content-pack.mjs <new-directory> --name <npm-name> --project-id <id> --namespace <namespace> [--json]

The destination must not exist. This writes source files only; it does not install, execute, publish, or approve packages.`

function argumentsFor(args) {
  if (args.includes('--help')) return { help: true }
  const [destination, ...tail] = args
  if (!destination || destination.startsWith('--')) throw new Error('A new destination directory is required')
  const values = {}
  for (let index = 0; index < tail.length; index++) {
    const option = tail[index]
    if (option === '--json') {
      if (values.json) throw new Error('Duplicate option --json')
      values.json = true
      continue
    }
    if (!['--name', '--project-id', '--namespace'].includes(option)) throw new Error(`Unknown option ${option}`)
    if (values[option] !== undefined) throw new Error(`Duplicate option ${option}`)
    const value = tail[++index]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${option}`)
    values[option] = value
  }
  if (
    !values['--name'] ||
    values['--name'].length > 214 ||
    !/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(values['--name'])
  )
    throw new Error('Use a lowercase npm package name, for example @your-scope/slow')
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(values['--project-id'] ?? ''))
    throw new Error('Project ID must use 1–80 letters, digits, dots, underscores or hyphens')
  if (!/^[a-z0-9][a-z0-9_.-]{0,79}$/.test(values['--namespace'] ?? ''))
    throw new Error('Namespace must use 1–80 lowercase letters, digits, dots, underscores or hyphens')
  return {
    destination,
    name: values['--name'],
    projectId: values['--project-id'],
    namespace: values['--namespace'],
    json: !!values.json,
  }
}

function rewriteReferences(value, from, to) {
  if (Array.isArray(value)) return value.map(item => rewriteReferences(item, from, to))
  if (!value || typeof value !== 'object') return value
  const result = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, rewriteReferences(item, from, to)]),
  )
  if (result.$ref && typeof result.$ref === 'object' && result.$ref.projectId === from) result.$ref.projectId = to
  return result
}

async function main() {
  const options = argumentsFor(process.argv.slice(2))
  if (options.help) return console.log(help)
  const target = resolve(options.destination)
  const manifest = JSON.parse(await readFile(join(sample, 'package.json'), 'utf8'))
  const content = JSON.parse(await readFile(join(sample, 'content.json'), 'utf8'))
  const originalProjectId = manifest.arcadia.projectId
  manifest.name = options.name
  manifest.arcadia.projectId = options.projectId
  manifest.arcadia.namespace = options.namespace
  manifest.scripts.test = 'npm run build && node --test test/*.test.mjs'
  // No --force or recursive mkdir: never replace or merge an existing project.
  await mkdir(target)
  for (const directory of [
    'src',
    'test',
    'assets',
    '.agents',
    '.agents/skills',
    '.agents/skills/arcadia-content-authoring',
  ])
    await mkdir(join(target, directory))
  for (const file of ['tsconfig.json', 'src/effects.ts', 'test/slow.test.mjs'])
    await copyFile(join(sample, file), join(target, file))
  await copyFile(
    fileURLToPath(new URL('../../docs/v4/ugc-authoring-agent/SKILL.md', import.meta.url)),
    join(target, '.agents/skills/arcadia-content-authoring/SKILL.md'),
  )
  await writeFile(join(target, 'package.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
  await writeFile(
    join(target, 'content.json'),
    JSON.stringify(rewriteReferences(content, originalProjectId, options.projectId), null, 2) + '\n',
    { flag: 'wx' },
  )
  await writeFile(join(target, 'assets/.gitkeep'), '', { flag: 'wx' })
  await writeFile(
    join(target, 'README.md'),
    `# ${options.name}\n\nThis private starter implements a two-turn slow. Change the source and content together, and add tests for your own behavior.\n\nInstall matching Arcadia SDK development dependencies from your trusted SDK distribution, then run \`npm test\`. The SDK versions in package.json are compatibility targets, not proof that packages are published.\n\n\`npm test\` builds TypeScript, packs the current project, installs it into a temporary npm project without lifecycle scripts and runs a real-engine hit/miss/refresh/removal, waiting-point restoration and natural-expiry scenario. It does not publish or approve a production environment.\n\nServer installation, code admission and activation are separate. Ask the server administrator to inspect and explicitly approve the packed installation before previewing. The included .agents/skills/arcadia-content-authoring/SKILL.md guides compatible coding agents; see the matching host npm content documentation.\n`,
    { flag: 'wx' },
  )
  const result = {
    format: 'arcadia.content-scaffold',
    version: 1,
    directory: target,
    package: options.name,
    projectId: options.projectId,
    namespace: options.namespace,
  }
  console.log(
    options.json
      ? JSON.stringify(result)
      : `Created ${options.name} at ${target}\nInstall the matching SDK dependencies before running npm test.`,
  )
}

main().catch(error => {
  const json = process.argv.includes('--json')
  const message = error instanceof Error ? error.message : String(error)
  console.error(
    json ? JSON.stringify({ error: 'SCAFFOLD_FAILED', message }) : `Cannot create content package: ${message}`,
  )
  process.exitCode = 1
})
