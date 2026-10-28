#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const [command, ...args] = process.argv.slice(2)
const help = `arcadia-content <command>
  check     Check TypeScript and JSON/YAML content
  build     Compile TypeScript and assemble dist/content.json
  rename    Change package/project/namespace identities and local references
  demo      Run the battle configured in arcadia.config.mjs
  pack      Check, build and create an npm content package
  setup     Install the pinned development SDK and tool
`
function run(file, arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, arguments_, { stdio: 'inherit', cwd: process.cwd() })
    child.on('error', reject)
    child.on('exit', (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`${file} failed (${signal ?? code})`)),
    )
  })
}
const modulePath = name => fileURLToPath(new URL(name, import.meta.url))
async function data(check = false) {
  await run(process.execPath, [modulePath('./build-content.mjs'), ...(check ? ['--check'] : [])])
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
}
try {
  if (!command || command === '--help' || command === '-h') console.log(help)
  else if (command === 'setup') {
    const { setup } = await import('./setup.mjs')
    await setup(args)
  } else if (command === 'rename') await run(process.execPath, [modulePath('./rename.mjs'), ...args])
  else {
    if (!['check', 'build', 'demo', 'pack'].includes(command) || args.length)
      throw new Error(`Unknown command or option.\n${help}`)
    if (command === 'check') {
      await data(true)
      await types(true)
    } else if (command === 'build') await build()
    else if (command === 'demo') await import('./demo.mjs')
    else {
      await build()
      await run('npm', ['pack', '--ignore-scripts'])
    }
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
