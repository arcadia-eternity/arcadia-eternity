import { afterEach, expect, it } from 'vitest'
import { Command } from 'commander'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerNpmCommands } from '../src/commands/npm'

const previousCli = process.env.ARCADIA_NPM_CLI
const previousPath = process.env.PATH
const roots: string[] = []
afterEach(async () => {
  if (previousCli === undefined) delete process.env.ARCADIA_NPM_CLI
  else process.env.ARCADIA_NPM_CLI = previousCli
  if (previousPath === undefined) delete process.env.PATH
  else process.env.PATH = previousPath
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

it('runs npm install and inspection with the configured CLI and without PATH resolution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-cli npm-'))
  roots.push(root)
  const manifest = { name: 'server', version: '1.0.0', private: true }
  await writeFile(join(root, 'package.json'), JSON.stringify(manifest))
  await writeFile(
    join(root, 'package-lock.json'),
    JSON.stringify({ name: manifest.name, version: manifest.version, lockfileVersion: 3, packages: { '': manifest } }),
  )
  const cli = join(root, 'npm runner.cjs')
  const log = join(root, 'calls.jsonl')
  await writeFile(
    cli,
    `const fs = require('node:fs'); const args = process.argv.slice(2); fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args)+String.fromCharCode(10)); if (args[0] === 'ci') fs.mkdirSync('node_modules'); else if (args[0] === 'ls') process.stdout.write(JSON.stringify({dependencies:{}})); else process.exit(1);`,
  )
  process.env.ARCADIA_NPM_CLI = cli
  process.env.PATH = ''
  let output = ''
  const program = new Command().exitOverride()
  registerNpmCommands(program.command('content'), {
    cwd: root,
    signal: new AbortController().signal,
    stdout: async text => {
      output += text
    },
    stderr: async () => {},
  })
  await program.parseAsync(['content', 'npm', 'install', root, '--offline', '--json'], { from: 'user' })
  expect(JSON.parse(output)).toMatchObject({ format: 'arcadia.npm-installation', packages: [] })
  expect(
    (await readFile(log, 'utf8'))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line)),
  ).toEqual([
    ['ci', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--offline'],
    ['ls', '--all', '--long', '--json', '--omit=dev', '--ignore-scripts'],
  ])
})
