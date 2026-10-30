#!/usr/bin/env node
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolveNpmInvocation } from '@arcadia-eternity/pack-loader/node'
const require = createRequire(import.meta.url)
const [command, ...args] = process.argv.slice(2)
const help = `arcadia-content <command>
  check     Check TypeScript and JSON/YAML content
  build     Compile TypeScript and assemble content/media/locales metadata
  rename    Change package/project/namespace identities and local references
  demo      Run the battle configured in arcadia.config.mjs
  pack      Check, build and create an npm content package
  setup     Install the pinned development SDK and tool
  workspace <directory> <operation> [--execute]  Structured author operations
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
  else if (command === 'workspace') {
    const { workspaceCli } = await import('./workspace-cli.mjs')
    await workspaceCli(args)
  } else if (command === 'setup') {
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
      const manifest = JSON.parse(await readFile(resolve('package.json'), 'utf8'))
      const presentation = JSON.parse(await readFile(resolve('dist/presentation.json'), 'utf8'))
      if (presentation.resources.length || Object.keys(presentation.locales).length) {
        if (manifest.arcadia?.presentation !== 'dist/presentation.json')
          throw new Error('Set arcadia.presentation to dist/presentation.json before packing media/locales')
        const npm = await resolveNpmInvocation(['pack', '--dry-run', '--ignore-scripts', '--json'])
        const { stdout } = await promisify(execFile)(npm.file, npm.args, {
          cwd: process.cwd(),
        })
        const included = new Set(JSON.parse(stdout)[0].files.map(file => file.path))
        const required = [
          'dist/content.json',
          'dist/presentation.json',
          ...presentation.resources.filter(resource => resource.kind === 'file').map(resource => resource.source),
        ]
        for (const file of required)
          if (!included.has(file)) throw new Error(`npm files omits required presentation file: ${file}`)
      }
      const npm = await resolveNpmInvocation(['pack', '--ignore-scripts', '--json'])
      const { stdout } = await promisify(execFile)(npm.file, npm.args, { cwd: process.cwd() })
      const packed = JSON.parse(stdout)[0]
      console.log(`Packed ${packed.filename}`)
      console.log(
        `ARCADIA_RESULT=${JSON.stringify({ filename: packed.filename, integrity: packed.integrity, shasum: packed.shasum, files: packed.files.map(file => file.path) })}`,
      )
    }
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
