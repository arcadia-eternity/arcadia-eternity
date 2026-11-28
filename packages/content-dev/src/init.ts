import { constants } from 'node:fs'
import { cp, copyFile, lstat, mkdir, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import { connectDevelopmentSdk, copyAuthorSkill, createSourceProject } from './project.ts'
import { errorCode } from './types.ts'

const require = createRequire(import.meta.url)
const usage = 'Usage: arcadia-content init <pack|environment> <directory> [--id <id>]'
const basePackage = '@arcadia-eternity/data-pack-base'

async function environmentTemplate() {
  for (const location of ['./environment-template/', '../environment-template/']) {
    const path = fileURLToPath(new URL(location, import.meta.url))
    try {
      await lstat(path)
      return path
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error
    }
  }
  throw new Error('The SDK is missing its environment template')
}

async function createEnvironment(directory: string, id: string) {
  const sdkVersion: string = require('../package.json').version
  let baseVersion = '*'
  try {
    baseVersion = require(basePackage + '/package.json').version
  } catch (error) {
    if (errorCode(error) !== 'MODULE_NOT_FOUND') throw error
  }
  const manifest = {
    name: '@arcadia-local/' + id,
    version: '0.1.0',
    private: true,
    license: 'MIT',
    type: 'module',
    files: ['debug/teams', 'candidates'],
    scripts: {
      check: 'arcadia-content check',
      demo: 'arcadia-content demo',
      preview: 'arcadia-content preview',
      pack: 'arcadia-content pack',
      release: 'arcadia-content pack --release',
    },
    engines: { arcadia: '^' + sdkVersion },
    devDependencies: { '@arcadia-eternity/content-sdk': sdkVersion },
    dependencies: { [basePackage]: baseVersion },
    arcadiaEnvironment: { schemaVersion: 2, id, name: id, sources: [], rules: { schemaVersion: 1 }, requires: {} },
  }
  await cp(await environmentTemplate(), directory, { recursive: true, force: false, errorOnExist: true })
  const teams = join(directory, 'debug', 'teams')
  await mkdir(teams, { recursive: true })
  await writeFile(join(directory, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  await writeFile(join(directory, '.gitignore'), 'node_modules/\n.arcadia/\n/*.tgz\nrelease-output/\npack.log\n')
  for (const [name, species, skill] of [
    ['Blue', 'pet_dilan', 'skill_paida'],
    ['Orange', 'pet_xiuxiu', 'skill_lizhua'],
  ]) {
    const id = name.toLowerCase()
    const stats = (value: number) => ({ hp: value, atk: value, def: value, spa: value, spd: value, spe: value })
    const pet = { name: species, species, level: 100, nature: 'Hardy', skills: [skill], evs: stats(0), ivs: stats(31) }
    await writeFile(join(teams, id + '.yaml'), YAML.stringify({ schemaVersion: 1, id, name, team: [pet] }))
  }
  await copyAuthorSkill(directory)
  await connectDevelopmentSdk(directory)
}

export async function initCommand(args: string[]) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage)
    return
  }
  const [kind, path, ...flags] = args
  if (
    (kind !== 'pack' && kind !== 'environment') ||
    !path ||
    path.startsWith('-') ||
    (flags.length > 0 && (flags.length !== 2 || flags[0] !== '--id'))
  )
    throw new Error(usage)
  const directory = resolve(path)
  const id = flags[1] ?? basename(directory)
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id) || (kind === 'environment' && id === 'default'))
    throw new Error(
      'Invalid project ID. Supply --id with a lowercase alphanumeric or hyphenated name; default is reserved for environments.',
    )

  await mkdir(dirname(directory), { recursive: true })
  let created = true
  try {
    await mkdir(directory)
  } catch (error) {
    if (errorCode(error) !== 'EEXIST') throw error
    created = false
    if (!(await lstat(directory)).isDirectory() || (await readdir(directory)).length)
      throw new Error('Project destination must be a new or empty directory: ' + directory, { cause: error })
  }

  // Reserve the empty destination while generating the template. Keep the directory
  // itself intact so "init ." also works in the caller's current working directory.
  const staging = join(directory, '.arcadia-init')
  await mkdir(staging)
  const project = join(staging, 'project')
  const installed: string[] = []
  try {
    if ((await readdir(directory)).some(name => name !== '.arcadia-init'))
      throw new Error('Project destination is no longer empty: ' + directory)
    if (kind === 'pack') await createSourceProject(project, id)
    else await createEnvironment(project, id)
    const entries = await readdir(project, { withFileTypes: true })
    // package.json is the completion marker for tools opening the new project.
    entries.sort((a, b) => Number(a.name === 'package.json') - Number(b.name === 'package.json'))
    for (const entry of entries) {
      const source = join(project, entry.name)
      const target = join(directory, entry.name)
      if (entry.isDirectory()) {
        await mkdir(target)
        installed.push(target)
        // Move children into the directory we just reserved. Re-copying SDK
        // junctions on Windows would require permission to create symlinks.
        for (const child of await readdir(source)) await rename(join(source, child), join(target, child))
      } else {
        await copyFile(source, target, constants.COPYFILE_EXCL)
        installed.push(target)
      }
    }
  } catch (error) {
    for (const target of installed.reverse()) await rm(target, { recursive: true, force: true })
    throw error
  } finally {
    await rm(staging, { recursive: true, force: true })
    if (created && !(await readdir(directory)).length) await rmdir(directory)
  }
  console.log(JSON.stringify({ kind, directory, id }))
}
