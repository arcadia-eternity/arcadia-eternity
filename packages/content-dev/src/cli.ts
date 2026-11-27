#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { siblingModulePath } from './module-path.ts'
import { errorMessage } from './types.ts'
import { commandHelp as help, commandsCli } from './command-discovery.ts'
const require = createRequire(import.meta.url)
const [command, ...args] = process.argv.slice(2)
function run(file: string, arguments_: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(file, arguments_, { stdio: 'inherit', cwd: process.cwd() })
    child.on('error', reject)
    child.on('exit', (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`${file} failed (${signal ?? code})`)),
    )
  })
}
async function data(check = false) {
  await run(process.execPath, [siblingModulePath('build-content'), ...(check ? ['--check'] : [])])
}
async function types(check = false) {
  await run(process.execPath, [
    require.resolve('typescript/bin/tsc'),
    '-p',
    'tsconfig.json',
    ...(check ? ['--noEmit'] : []),
  ])
}
async function build() {
  await data(true)
  await types()
  await data()
  const { buildEffects } = await import('./effect-build.ts')
  await buildEffects(process.cwd())
}
try {
  if (!command || command === '--help' || command === '-h') console.log(help)
  else if (command === 'commands') await commandsCli(args)
  else if (command === 'desktop') await (await import('./desktop-cli.ts')).desktopCli(args)
  else if (command === 'registry') await (await import('./registry-cli.ts')).registryCli(args)
  else if (command === 'init') await (await import('./init.ts')).initCommand(args)
  else if (command === 'workspace') {
    const { workspaceCli } = await import('./workspace-cli.ts')
    await workspaceCli(args)
  } else if (command === 'setup') {
    const { setup } = await import('./setup.ts')
    await setup(args)
  } else if (command === 'rename') await run(process.execPath, [siblingModulePath('rename'), ...args])
  else {
    if (
      !['check', 'build', 'demo', 'preview', 'pack'].includes(command) ||
      (args.length &&
        !(command === 'pack' && args.length === 1 && args[0] === '--release') &&
        !(
          command === 'demo' &&
          args.length === 2 &&
          args[0] === '--seed' &&
          args[1].length > 0 &&
          args[1].length <= 200
        ))
    )
      throw new Error(`Unknown command or option.\n${help}`)
    if (command === 'demo') {
      if (args.length) process.env.ARCADIA_DEBUG_SEED = args[1]
      await import('./demo.ts')
    } else if (command === 'preview') await (await import('./preview.ts')).previewCommand()
    else if (command === 'pack') {
      const standalone = await checkStandaloneEnvironment(command)
      const release = args[0] === '--release'
      if (standalone && release) throw new Error('Use pack to build an installable environment recipe.')
      if (!standalone) await build()
      const { packBuiltProject, packEnvironmentProject } = await import('./pack-project.ts')
      const packed = standalone
        ? await packEnvironmentProject(process.cwd())
        : await packBuiltProject(process.cwd(), { release })
      console.log(`Packed ${packed.filename}`)
      console.log(
        `ARCADIA_RESULT=${JSON.stringify({ ...(release ? { verifiedRelease: true } : {}), filename: packed.filename, integrity: packed.integrity, shasum: packed.shasum, files: packed.files.map(file => file.path) })}`,
      )
    } else if (await checkStandaloneEnvironment(command)) {
      console.log('Environment declaration OK')
    } else if (command === 'check') {
      await data(true)
      await types(true)
    } else if (command === 'build') await build()
  }
} catch (error) {
  console.error(errorMessage(error))
  process.exitCode = 1
}

async function checkStandaloneEnvironment(operation: string) {
  const text = await readFile('package.json', 'utf8')
  const manifest = JSON.parse(text)
  if (manifest.arcadia || !Object.hasOwn(manifest, 'arcadiaEnvironment')) return false
  if (operation === 'pack') return true
  if (operation !== 'check')
    throw new Error(
      'Standalone environment projects support check, demo, preview and pack. This build command requires a content pack.',
    )
  const { environmentProjectDocument } = await import('./debug-environments.ts')
  const { assertEnvironmentRequirements, prepareEnvironmentRules } = await import('./environment-rules.ts')
  const document = environmentProjectDocument(manifest)
  assertEnvironmentRequirements(document.requires)
  prepareEnvironmentRules(document.rules)
  return true
}
