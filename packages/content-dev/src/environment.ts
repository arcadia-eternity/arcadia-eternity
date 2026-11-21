import { sha256Hex } from '@arcadia-eternity/const'
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
import { AuthorWorkspace, type PackageManifest } from './workspace.ts'
import { ProjectTeams, playersFromTeams, type ProjectTeam } from './project-teams.ts'
import { gameplayRevision } from '@arcadia-eternity/pack-loader/native'
import { DebugEnvironments, normalizeEnvironmentDocument, type EnvironmentDocumentV2 } from './debug-environments.ts'
import {
  assertEnvironmentRequirements,
  defaultRuleDeclaration,
  prepareRulesForContent,
  validateEnvironmentRuleDeclaration,
} from './environment-rules.ts'
import { siblingModulePath } from './module-path.ts'
import { errorCode } from './types.ts'
import { packBuiltProject } from './pack-project.ts'
import { findAuthorInstallation, stageInstalledDependencies } from './author-install.ts'
import { stageEnvironmentDependencies } from './debug-environment-install.ts'

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
  kind: 'pack' | 'environment'
  members: Array<{ name: string; version: string }>
  packageName: string | undefined
  version: string | undefined
  integrity?: string
  shasum?: string
  sdkApi?: unknown
  build: unknown
  environmentRevision: string
  environmentId: string
  environmentConfigVersion: string | null
}

export interface PreparedBattleEnvironment {
  environment: PreparedNpmEnvironment
  environmentDocument: EnvironmentDocumentV2
  effectiveRules: ReturnType<typeof prepareRulesForContent>['rules']
  candidate: ContentCandidate
  environmentLock: { file: string; version: string } | undefined
  sourceRevisions: Record<string, string>
  loadTeams(ids: string[]): ReturnType<typeof playersFromTeams>
  teams: ProjectTeam[]
  teamVersions: Record<string, string | null>
  manifest: PackageManifest
  files: string[]
  dispose(): Promise<void>
  track(battle: BattleLike): void
  untrack(battle: BattleLike): void
}

async function npm(args: string[], options: ExecFileOptions) {
  const invocation = await resolveNpmInvocation(args)
  return exec(invocation.file, invocation.args, options)
}

async function packAuthorProject(root: string, directory: string, manifest: PackageManifest, cacheArgs: string[]) {
  const archive = process.env.ARCADIA_TEST_RELEASE_ARCHIVE
  if (archive && !/^[a-z0-9][a-z0-9._-]*\.tgz$/.test(archive)) throw new Error('Invalid release archive filename')
  const result = await npm(
    [
      'pack',
      ...(archive ? [join(root, archive)] : []),
      '--json',
      '--ignore-scripts',
      '--pack-destination',
      directory,
      ...cacheArgs,
    ],
    { cwd: root },
  )
  const packed = requirePackedInfo(parseNpmPackOutput(String(result.stdout))[0])
  if (archive && packed.integrity !== process.env.ARCADIA_TEST_RELEASE_INTEGRITY)
    throw new Error('Release archive integrity changed before testing')
  const files = packed.files.map(file => file.path)
  assert.ok(manifest.arcadia?.content && files.includes(manifest.arcadia.content))
  if (!archive && manifest.arcadia.effects) assert.ok(files.includes(manifest.arcadia.effects as string))
  assert.ok(
    !files.some(file => /^(?:\.arcadia|\.github|node_modules|test|scripts|debug)\//.test(file)),
    'the package must contain content, not a developer workspace',
  )
  return packed
}

/** Pack and install exactly what a consuming server receives. Approval is limited to this local demo. */
export async function prepareBattleEnvironment(
  root: string = process.cwd(),
  {
    offline,
    cache,
    environmentId = 'default',
    sources = {},
    lockRoot,
    sourceRoot = lockRoot ?? root,
  }: {
    offline?: boolean
    cache?: string
    environmentId?: string
    sources?: Record<string, string | undefined>
    lockRoot?: string
    sourceRoot?: string
  } = {},
): Promise<PreparedBattleEnvironment> {
  root = resolve(root)
  const temporary = await mkdtemp(join(tmpdir(), 'arcadia-pack-template-'))
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
    const manifest = JSON.parse((await workspace.read('package.json')).text) as PackageManifest
    const standalone = workspace.projectKind === 'environment'
    const definitions = await new DebugEnvironments(workspace).list()
    const selected =
      standalone && environmentId === 'default' ? definitions[0] : definitions.find(entry => entry.id === environmentId)
    if (!selected) throw new Error(`ENVIRONMENT_MISSING: ${environmentId}`)
    environmentId = selected.id
    const { version: _version, ...selectedDocument } = selected
    const environmentDocument: EnvironmentDocumentV2 =
      selected.id === 'default'
        ? { ...selectedDocument, schemaVersion: 2, rules: { schemaVersion: 1 }, requires: {} }
        : normalizeEnvironmentDocument(selectedDocument)
    assertEnvironmentRequirements(environmentDocument.requires)
    validateEnvironmentRuleDeclaration(environmentDocument.rules)
    const lockFile = environmentId === 'default' ? undefined : `debug/environments/${environmentId}.package-lock.json`
    let oldLock: { file: string; text: string; version: string } | undefined
    if (lockFile) {
      try {
        oldLock = await workspace.read(lockFile)
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error
      }
    }
    const durable = await findAuthorInstallation(sourceRoot, manifest.dependencies, root)
    if (durable) cacheArgs.splice(0, cacheArgs.length, '--cache', join(dirname(durable.directory), 'npm-cache'))
    const packed = standalone ? undefined : await packAuthorProject(root, temporary, manifest, cacheArgs)
    const files = packed?.files.map(file => file.path) ?? []
    const installation = join(temporary, 'server-project')
    await mkdir(join(installation, 'candidates'), { recursive: true })
    const dependencies: Record<string, string> = { ...selected.packages }
    async function addCandidate(directory: string, metadata: { name: string }, packedInfo: PackedInfo): Promise<void> {
      if (Object.hasOwn(dependencies, metadata.name)) throw new Error(`ENVIRONMENT_DUPLICATE: ${metadata.name}`)
      const filename = `candidates/${packedInfo.shasum}.tgz`
      await cp(join(directory, packedInfo.filename), join(installation, filename))
      dependencies[metadata.name] = `file:${filename}`
    }
    if (packed) {
      if (!manifest.name) throw new Error('ENVIRONMENT_PACKAGE_NAME_MISSING')
      await addCandidate(temporary, { name: manifest.name }, packed)
    }
    let candidateOverrides: Record<string, Record<string, string>> | undefined
    let installLock = oldLock?.text
    let installed: string | undefined
    if (standalone && !selected.sources.length) {
      installed = durable?.directory
    }
    if (standalone && !installed && !durable) {
      const sourceLock = await workspace.read('package-lock.json').catch(error => {
        if (errorCode(error) !== 'ENOENT') throw error
        return undefined
      })
      installLock = sourceLock?.text ?? installLock
      const staged = await stageEnvironmentDependencies({
        materialRoot: root,
        sourceRoot,
        installation,
        dependencies,
        hasSources: selected.sources.length > 0,
        lockText: installLock,
        sourceLocked: !!sourceLock,
      })
      installed = staged.installed
      installLock = staged.lockText
    }
    if (!installed && durable) {
      const staged = await stageInstalledDependencies(
        durable,
        manifest.dependencies,
        installation,
        dependencies,
        selected.sources,
        installLock,
      )
      installLock = staged.lock
      if (!standalone && manifest.name) candidateOverrides = { [manifest.name]: staged.localOverrides }
    }
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
          standalone
            ? await packBuiltProject(captured, { cache: cacheArgs[1] })
            : parseNpmPackOutput(
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
    if (!installed) {
      if (installLock) await writeFile(join(installation, 'package-lock.json'), installLock)
      await writeFile(
        join(installation, 'package.json'),
        JSON.stringify({
          name: 'arcadia-template-demo-server',
          version: '1.0.0',
          private: true,
          dependencies,
          ...(candidateOverrides && { overrides: candidateOverrides }),
        }),
      )
      await npm(
        [
          'install',
          ...((offline ?? (!standalone && !process.env.ARCADIA_TEST_RELEASE_ARCHIVE)) ? ['--offline'] : []),
          '--ignore-scripts',
          '--omit=dev',
          '--no-audit',
          '--no-fund',
          ...cacheArgs,
        ],
        { cwd: installation },
      )
      await mkdir(join(installation, 'node_modules'), { recursive: true })
      installed = installation
    }
    environment = await prepareNpmProject(
      installed,
      emptyNpmContentHost,
      {
        policy: { profile: 'local-development' },
      },
      process.env.ARCADIA_TEST_RELEASE_ARCHIVE || standalone ? { effectPreparation: 'prebuilt-only' } : {},
    )
    if (!standalone && environmentId === 'default')
      environmentDocument.rules = defaultRuleDeclaration(environment.sandbox.data.ruleSets)
    const { rules: effectiveRules } = prepareRulesForContent(environmentDocument.rules, environment.sandbox.data)
    let environmentLock: { file: string; version: string } | undefined
    if (lockFile) {
      const text = await readFile(join(installed, 'package-lock.json'), 'utf8')
      if (lockRoot) {
        lockWorkspace = await AuthorWorkspace.open(resolve(lockRoot), { watch: false })
        const saved = await lockWorkspace.write({ file: lockFile, expectedVersion: oldLock?.version ?? null, text })
        environmentLock = { file: lockFile, version: saved.version }
      } else environmentLock = { file: lockFile, version: sha256Hex(text) }
    }
    const teamLibrary = await new ProjectTeams(workspace).list()
    function loadTeams(ids: string[]) {
      return playersFromTeams(teamLibrary, ids)
    }
    const candidate: ContentCandidate = {
      kind: standalone ? 'environment' : 'pack',
      members: environment.installation.members.map(({ name, version }) => ({ name, version })),
      packageName: manifest.name,
      version: manifest.version,
      ...(packed && { integrity: packed.integrity ?? '', shasum: packed.shasum, sdkApi: manifest.arcadia?.sdkApi }),
      build: environment.build,
      environmentRevision: await gameplayRevision(
        {
          kind: 'native-v4',
          contentRevision: environment.revision,
          coreBuildId: environment.build.coreBuildId,
          registryBuildId: environment.build.registryBuildId,
        },
        environment.sandbox.revision,
        effectiveRules,
      ),
      environmentId,
      environmentConfigVersion: selected.version,
    }
    if (process.env.ARCADIA_AUTHOR_RESULT === '1')
      console.log(`ARCADIA_RESULT=${JSON.stringify({ candidate, environmentLock, sourceRevisions })}`)
    return {
      environment,
      environmentDocument,
      effectiveRules,
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
