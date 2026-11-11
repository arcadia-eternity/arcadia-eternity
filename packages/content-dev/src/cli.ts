#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { siblingModulePath } from './module-path.ts'
import { errorMessage } from './types.ts'
const require = createRequire(import.meta.url)
const [command, ...args] = process.argv.slice(2)
const help = `arcadia-content <command>
  check     Check TypeScript and JSON/YAML content
  build     Compile TypeScript and assemble content/media/locales metadata
  rename    Change package/project/namespace identities and local references
  demo      Run the battle configured in arcadia.config.mjs
  preview   Prepare a local candidate for the full battle client; stop with Ctrl+C
  pack      Check, build and create an npm content package
  setup     Install the pinned development SDK and tool
  workspace <directory> <operation> [--execute]  Structured author operations
`
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
  else if (command === 'workspace') {
    const { workspaceCli } = await import('./workspace-cli.ts')
    await workspaceCli(args)
  } else if (command === 'setup') {
    const { setup } = await import('./setup.ts')
    await setup(args)
  } else if (command === 'rename') await run(process.execPath, [siblingModulePath('rename'), ...args])
  else {
    if (!['check', 'build', 'demo', 'preview', 'pack'].includes(command) || args.length)
      throw new Error(`Unknown command or option.\n${help}`)
    if (command === 'check') {
      await data(true)
      await types(true)
    } else if (command === 'build') await build()
    else if (command === 'demo') await import('./demo.ts')
    else if (command === 'preview') await (await import('./preview.ts')).previewCommand()
    else {
      await build()
      const { packBuiltProject } = await import('./pack-project.ts')
      const packed = await packBuiltProject()
      console.log(`Packed ${packed.filename}`)
      console.log(
        `ARCADIA_RESULT=${JSON.stringify({ filename: packed.filename, integrity: packed.integrity, shasum: packed.shasum, files: packed.files.map((file: { path: string }) => file.path) })}`,
      )
    }
  }
} catch (error) {
  console.error(errorMessage(error))
  process.exitCode = 1
}
