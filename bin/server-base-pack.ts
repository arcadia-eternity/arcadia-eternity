import { createRequire } from 'node:module'
import { Command, CommanderError } from 'commander'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, stat } from 'node:fs/promises'
import {
  findPackageUpdate,
  installServerBaseUpdate,
  officialPackage,
  selectServerBase,
} from '@arcadia-eternity/content-sdk/managed-projects'
import { catalogMaterialDigest, withShippedEnvironmentProject } from '@arcadia-eternity/pack-loader/node'
import { readOfficialEnvironments } from '@arcadia-eternity/content-sdk/management-workspace'
import { validateWorkspaceProject } from '@arcadia-eternity/server'
import host from '@arcadia-eternity/pack-loader/package.json' with { type: 'json' }

export const shippedBaseRoot = () =>
  dirname(fileURLToPath(import.meta.resolve('@arcadia-eternity/data-pack-base/package.json')))
const store = (dataDirectory: string) => join(dataDirectory, 'official-base')
export const serverBase = (dataDirectory: string, pin?: string) =>
  selectServerBase(store(dataDirectory), shippedBaseRoot(), host.version, pin, validateBase)

/** Remember host-selected materials so pinned environments survive a later server upgrade. */
export async function serverOfficialMaterials(dataDirectory: string, selected: string) {
  const records = join(store(dataDirectory), 'known-materials')
  // The digest includes the package version. Creating a directory records it atomically.
  await mkdir(join(records, await catalogMaterialDigest(selected)), { recursive: true, mode: 0o700 })
  return async (digest: string) => {
    if (!/^[a-f0-9]{64}$/.test(digest)) return false
    const record = await stat(join(records, digest)).catch(error => {
      if (error.code !== 'ENOENT') throw error
    })
    return record?.isDirectory() === true
  }
}

export function serverOfficialEnvironments(directory: string) {
  return readOfficialEnvironments(
    directory,
    createRequire(import.meta.url).resolve,
    directory === shippedBaseRoot() ? undefined : join(dirname(directory), 'official-environments.json'),
  )
}

async function validateBase(directory: string, signal?: AbortSignal) {
  const catalog = await serverOfficialEnvironments(directory)
  await withShippedEnvironmentProject(directory, async project => {
    for (const draft of catalog.environments)
      await validateWorkspaceProject({ directory: project, draft, signal }, { effectPreparation: 'prebuilt-only' })
  })
}

/** Only promote the staged directory to the offline startup cache after both presets are usable. */
export async function updateRunningServerBase(
  dataDirectory: string,
  current: { directory: string; version: string },
  activate: (directory: string, signal?: AbortSignal) => Promise<void>,
  signal: AbortSignal,
) {
  const candidate = await findPackageUpdate(officialPackage, current.version, host.version, signal)
  if (!candidate) return current
  let activating = false
  try {
    await installServerBaseUpdate(store(dataDirectory), candidate, host.version, validateBase, {
      signal,
      beforeCommit: async directory => {
        await serverOfficialMaterials(dataDirectory, directory)
        activating = true
        await activate(directory, signal)
      },
    })
  } catch (error) {
    if (activating) await activate(current.directory)
    throw error
  }
  console.info('Activated official base and environments:', candidate.version)
  return { version: candidate.version, directory: join(store(dataDirectory), candidate.version, 'package') }
}

export async function runServerBasePackCli(args: string[]) {
  const program = new Command('arcadia server base-pack')
    .exitOverride()
    .argument('<action>', 'check or update')
    .option(
      '--data-dir <directory>',
      'Persistent server data directory',
      process.env.ARCADIA_DATA_DIR ?? '.arcadia-server',
    )
  try {
    program.parse(args, { from: 'user' })
    const [action] = program.args
    if (action !== 'check' && action !== 'update') throw new Error('Expected base-pack check or update')
    if (process.env.ARCADIA_OFFLINE_CONTENT === '1') throw new Error('Offline content mode is enabled')
    const dataDirectory = resolve(program.opts<{ dataDir: string }>().dataDir)
    const current = await serverBase(dataDirectory)
    const candidate = await findPackageUpdate(officialPackage, current.version, host.version)
    if (action === 'update' && candidate)
      await installServerBaseUpdate(store(dataDirectory), candidate, host.version, validateBase)
    console.log(
      JSON.stringify({
        installedVersion: action === 'update' && candidate ? candidate.version : current.version,
        availableVersion: candidate?.version ?? null,
        hostVersion: host.version,
      }),
    )
    return 0
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) return 0
    console.error(error instanceof Error ? error.message : error)
    return 1
  }
}
