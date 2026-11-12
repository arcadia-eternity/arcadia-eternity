import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import type { ExecFileOptions } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile, cp, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { promisify } from 'node:util'
import {
  emptyNpmContentHost,
  parseNpmPackOutput,
  prepareNpmProject,
  resolveNpmInvocation,
  type NpmPackEntry,
} from '@arcadia-eternity/pack-loader/node'
import { AuthorWorkspace, type ManifestArcadia, type PackageManifest } from './workspace.ts'
import { ProjectTeams, playersFromTeams, type ProjectTeam } from './project-teams.ts'
import { createHash } from 'node:crypto'
import { DebugEnvironments, normalizeEnvironmentDocument, type EnvironmentDocumentV2 } from './debug-environments.ts'
import { assertEnvironmentRequirements, validateEnvironmentRules } from './environment-rules.ts'
import { siblingModulePath } from './module-path.ts'
import { errorCode } from './types.ts'

const exec = promisify(execFile)

type PreparedNpmEnvironment = Awaited<ReturnType<typeof prepareNpmProject>>

interface PackedInfo extends NpmPackEntry {
  shasum: string
}

function requirePackedInfo(entry: NpmPackEntry | undefined): PackedInfo {
  if (!entry?.shasum) throw new Error('ENVIRONMENT_PACK_INVALID')
  return { ...entry, shasum: entry.shasum }
}

export interface BattleLike {
  cleanup(): Promise<void>
}

export interface ContentCandidate {
  packageName: string | undefined
  version: string | undefined
  integrity: string
  shasum: string
  sdkApi: unknown
  build: unknown
  environmentRevision: string
  environmentId: string
  environmentConfigVersion: string | null
}

export interface PreparedBattleEnvironment {
  environment: PreparedNpmEnvironment
  environmentDocument: EnvironmentDocumentV2
  candidate: ContentCandidate
  environmentLock: { file: string; version: string } | undefined
  sourceRevisions: Record<string, string>
  loadTeams(ids: string[]): ReturnType<typeof playersFromTeams>
  teams: ProjectTeam[]
  teamVersions: Record<string, string | null>
  manifest: PackageManifest & { arcadia: ManifestArcadia }
  files: string[]
  dispose(): Promise<void>
  track(battle: BattleLike): void
  untrack(battle: BattleLike): void
}

async function npm(args: string[], options: ExecFileOptions) {
  const invocation = await resolveNpmInvocation(args)
  return exec(invocation.file, invocation.args, options)
}

/** Pack and install exactly what a consuming server receives. Approval is limited to this local demo. */
export async function prepareBattleEnvironment(
  root: string = process.cwd(),
  {
    offline = true,
    cache,
    environmentId = 'default',
    sources = {},
    lockRoot,
  }: {
    offline?: boolean
    cache?: string
    environmentId?: string
    sources?: Record<string, string | undefined>
    lockRoot?: string
  } = {},
): Promise<PreparedBattleEnvironment> {
  root = resolve(root)
  const temporary = await mkdtemp(join(tmpdir(), 'arcadia-pack-template-'))
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as PackageManifest & {
    arcadia: ManifestArcadia
  }
  const cacheArgs = cache ? ['--cache', resolve(cache)] : []
  const battles = new Set<BattleLike>()
  const sourceRevisions: Record<string, string> = {}
  let environment: PreparedNpmEnvironment | undefined,
    workspace: AuthorWorkspace | undefined,
    lockWorkspace: AuthorWorkspace | undefined
  async function dispose() {
    for (const battle of battles) await battle.cleanup()
    await environment?.dispose()
    await workspace?.close()
    await lockWorkspace?.close()
    await rm(temporary, { recursive: true, force: true })
  }
  try {
    workspace = await AuthorWorkspace.open(root, { watch: false })
    const selected = (await new DebugEnvironments(workspace).list()).find(entry => entry.id === environmentId)
    if (!selected) throw new Error(`ENVIRONMENT_MISSING: ${environmentId}`)
    const { version: _version, ...selectedDocument } = selected
    const environmentDocument: EnvironmentDocumentV2 =
      environmentId === 'default'
        ? {
            ...(selectedDocument as EnvironmentDocumentV2),
            schemaVersion: 2,
            rules: { schemaVersion: 1 },
            requires: {},
          }
        : normalizeEnvironmentDocument(selectedDocument)
    assertEnvironmentRequirements(environmentDocument.requires)
    validateEnvironmentRules(environmentDocument.rules)
    const lockFile = environmentId === 'default' ? undefined : `debug/environments/${environmentId}.package-lock.json`
    let oldLock: { file: string; text: string; version: string } | undefined
    if (lockFile) {
      try {
        oldLock = await workspace.read(lockFile)
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error
      }
    }
    const result = await npm(['pack', '--json', '--ignore-scripts', '--pack-destination', temporary, ...cacheArgs], {
      cwd: root,
    })
    const packed = requirePackedInfo(parseNpmPackOutput(String(result.stdout))[0])
    const files = packed.files.map(file => file.path)
    assert.ok(files.includes(manifest.arcadia.content!))
    if (manifest.arcadia.effects) assert.ok(files.includes(manifest.arcadia.effects as string))
    assert.ok(
      !files.some(file => /^(?:\.arcadia|\.github|node_modules|test|scripts|debug)\//.test(file)),
      'the package must contain content, not a developer workspace',
    )
    const installation = join(temporary, 'server-project')
    await mkdir(join(installation, 'candidates'), { recursive: true })
    const dependencies: Record<string, string> = { ...selected.packages }
    async function addCandidate(directory: string, metadata: { name: string }, packedInfo: PackedInfo): Promise<void> {
      if (Object.hasOwn(dependencies, metadata.name)) throw new Error(`ENVIRONMENT_DUPLICATE: ${metadata.name}`)
      const filename = `candidates/${packedInfo.shasum}.tgz`
      await cp(join(directory, packedInfo.filename), join(installation, filename))
      dependencies[metadata.name] = `file:${filename}`
    }
    await addCandidate(temporary, manifest as unknown as { name: string }, packed)
    for (const name of selected.sources) {
      const source = sources[name]
      if (typeof source !== 'string') throw new Error(`ENVIRONMENT_SOURCE_MISSING: ${name}，请设置本机源码映射`)
      const sourceWorkspace = await AuthorWorkspace.open(resolve(source), { watch: false })
      try {
        const before = await sourceWorkspace.revision({ contentOnly: true })
        sourceRevisions[name] = before
        const captured = join(temporary, `source-${Object.keys(dependencies).length}`)
        await mkdir(captured)
        for (const entry of await sourceWorkspace.files()) {
          if (entry.error) throw new Error(entry.error)
          await mkdir(dirname(join(captured, entry.file)), { recursive: true })
          await cp(await sourceWorkspace.path(entry.file), join(captured, entry.file))
        }
        if (before !== (await sourceWorkspace.revision({ contentOnly: true })))
          throw new Error('ENVIRONMENT_SOURCE_CHANGED')
        await symlink(
          join(sourceWorkspace.root, 'node_modules'),
          join(captured, 'node_modules'),
          process.platform === 'win32' ? 'junction' : 'dir',
        )
        const metadata = JSON.parse(await readFile(join(captured, 'package.json'), 'utf8')) as { name: string }
        if (metadata.name !== name) throw new Error(`ENVIRONMENT_SOURCE_IDENTITY: ${name}`)
        await exec(process.execPath, [siblingModulePath('cli'), 'build'], { cwd: captured })
        const info = requirePackedInfo(
          parseNpmPackOutput(
            String((await npm(['pack', '--json', '--ignore-scripts', ...cacheArgs], { cwd: captured })).stdout),
          )[0],
        )
        if (info.files.some(file => /^(?:debug|test|scripts|node_modules|\.arcadia|\.github)\//.test(file.path)))
          throw new Error('ENVIRONMENT_PACKAGE_FILES')
        await addCandidate(captured, metadata, info)
      } finally {
        await sourceWorkspace.close()
      }
    }
    if (oldLock) await writeFile(join(installation, 'package-lock.json'), oldLock.text)
    await writeFile(
      join(installation, 'package.json'),
      JSON.stringify({
        name: 'arcadia-template-demo-server',
        version: '1.0.0',
        private: true,
        dependencies,
      }),
    )
    await npm(
      [
        'install',
        ...(offline ? ['--offline'] : []),
        '--ignore-scripts',
        '--omit=dev',
        '--no-audit',
        '--no-fund',
        ...cacheArgs,
      ],
      { cwd: installation },
    )
    environment = await prepareNpmProject(installation, emptyNpmContentHost, {
      policy: { profile: 'local-development' },
    })
    let environmentLock: { file: string; version: string } | undefined
    if (lockFile) {
      const text = await readFile(join(installation, 'package-lock.json'), 'utf8')
      if (lockRoot) {
        lockWorkspace = await AuthorWorkspace.open(resolve(lockRoot), { watch: false })
        const saved = await lockWorkspace.write({ file: lockFile, expectedVersion: oldLock?.version ?? null, text })
        environmentLock = { file: lockFile, version: saved.version }
      } else environmentLock = { file: lockFile, version: createHash('sha256').update(text).digest('hex') }
    }
    const teamLibrary = await new ProjectTeams(workspace).list()
    function loadTeams(ids: string[]) {
      return playersFromTeams(teamLibrary, ids)
    }
    const candidate: ContentCandidate = {
      packageName: manifest.name,
      version: manifest.version,
      integrity: packed.integrity ?? '',
      shasum: packed.shasum,
      sdkApi: manifest.arcadia.sdkApi,
      build: environment.build,
      environmentRevision: environment.revision,
      environmentId,
      environmentConfigVersion: selected.version,
    }
    if (process.env.ARCADIA_AUTHOR_RESULT === '1')
      console.log(`ARCADIA_RESULT=${JSON.stringify({ candidate, environmentLock, sourceRevisions })}`)
    return {
      environment,
      environmentDocument,
      candidate,
      environmentLock,
      sourceRevisions,
      loadTeams,
      teams: teamLibrary,
      teamVersions: Object.fromEntries(teamLibrary.map(team => [team.id, team.version])),
      manifest,
      files,
      dispose,
      track: battle => battles.add(battle),
      untrack: battle => battles.delete(battle),
    }
  } catch (error) {
    await dispose()
    throw error
  }
}
