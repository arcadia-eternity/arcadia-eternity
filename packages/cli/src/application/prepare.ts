import { readInstalledEnvironmentDocument } from '@arcadia-eternity/content-sdk/prepared-document'
import { prepareRulesForContent, assertEnvironmentRequirements } from '@arcadia-eternity/content-sdk/environment-rules'
import type { EnvironmentRules } from '@arcadia-eternity/protocol'
import { readFile, stat } from 'node:fs/promises'
import {
  buildDisplayLocales,
  gameplayRevision,
  parseArchive,
  limits,
  WorkError,
  type NativePackLoadResult,
} from '@arcadia-eternity/pack-loader/native'
import { isAbsolute, resolve } from 'node:path'
import { ProfileRepository, expandTeam } from '@arcadia-eternity/local-profile'
import { FileProfileStorage, profileDirectory } from '@arcadia-eternity/local-profile/node'
import { NativePlayerSchema } from '@arcadia-eternity/battle/engine'
import { fileURLToPath } from 'node:url'
import {
  emptyNpmContentHost,
  NativeNodePackLoader,
  prepareShippedEnvironment,
  prepareNpmProject,
  readNpmAdmission,
  type PreparedNpmEnvironment,
} from '@arcadia-eternity/pack-loader/node'
import { createContentIndex, type ContentCatalog, type ContentIndex } from '@arcadia-eternity/battle/engine'
import { CliError, message } from '../reporting/errors'
import { readTeam } from '../io/files'
import type { PlayerLibraryEnvironment, RunSpec } from './types'

function prepareShippedContent() {
  return prepareShippedEnvironment(
    fileURLToPath(new URL('.', import.meta.resolve('@arcadia-eternity/data-pack-base/package.json'))),
  )
}

export async function createLoader() {
  const prepared = await prepareShippedContent()
  try {
    const { build, templates, effectIds } = prepared.authoring!
    return new NativeNodePackLoader(
      build,
      (data, revision) => createContentIndex(data, revision, { templates, effectIds }),
      { templates, effectModules: prepared.sandbox.modules },
    )
  } finally {
    await prepared.dispose()
  }
}

export type CliPreparedContent = Pick<
  NativePackLoadResult<ContentIndex>,
  'build' | 'content' | 'data' | 'locales' | 'npm' | 'packs' | 'revision' | 'sandbox' | 'works'
> & { rules?: EnvironmentRules; playerLibrary?: PlayerLibraryEnvironment }
export interface ContentSelectionOptions {
  works?: string
  npmProject?: string
  approval?: string
  environment?: string
  instance?: string
}

async function toCliContent(prepared: Readonly<PreparedNpmEnvironment>, explicitlyInstalled = false) {
  try {
    return {
      ...prepared,
      packs: prepared.installation.members.map(({ projectId, version }) => ({ id: projectId, version })),
      locales: buildDisplayLocales(prepared.presentation, {}, prepared.data).bundles,
      ...(explicitlyInstalled && { npm: { installationDigest: prepared.installation.digest } }),
    }
  } finally {
    await prepared.dispose()
  }
}
async function prepareInstalled(directory: string, approvalFile: string, prebuiltOnly = false) {
  const approval = await readNpmAdmission(approvalFile)
  const prepared = await prepareNpmProject(
    directory,
    emptyNpmContentHost,
    approval,
    prebuiltOnly ? { effectPreparation: 'prebuilt-only' } : {},
  )
  const content = await toCliContent(prepared, true)
  const document = await readInstalledEnvironmentDocument(directory, content.revision)
  assertEnvironmentRequirements(document?.requires)
  const { rules } = prepareRulesForContent(document?.rules, content.data)
  return { content: { ...content, rules }, environmentId: document?.id }
}

async function preparePlayerEnvironment(
  environmentId: string,
  instance?: string,
  signal?: AbortSignal,
): Promise<CliPreparedContent> {
  const { connectDesktopInstance } = await import('@arcadia-eternity/content-sdk/desktop')
  const connection = await connectDesktopInstance(instance, { signal })
  const lease = await connection.request({ operation: 'battle-environment-acquire', environmentId })
  const { leaseId } = lease
  if (typeof leaseId !== 'string' || !leaseId)
    throw new CliError('DESKTOP_RESPONSE_INVALID', 'Missing Desktop environment lease')
  try {
    if (
      typeof lease.directory !== 'string' ||
      !isAbsolute(lease.directory) ||
      typeof lease.environmentId !== 'string' ||
      typeof lease.contentRevision !== 'string' ||
      typeof lease.draftRevision !== 'string' ||
      !lease.draftRevision
    )
      throw new CliError('DESKTOP_RESPONSE_INVALID', 'Invalid Desktop environment snapshot')
    const installed = await prepareInstalled(lease.directory, resolve(lease.directory, 'arcadia-admission.json'), true)
    if (installed.environmentId !== lease.environmentId || installed.content.revision !== lease.contentRevision)
      throw new CliError(
        'ENVIRONMENT_REVISION_MISMATCH',
        'The prepared content does not match the acquired player-library environment',
      )
    const { build, revision, sandbox, rules } = installed.content
    const gameplay = await gameplayRevision(
      {
        kind: 'native-v4',
        contentRevision: revision,
        coreBuildId: build.coreBuildId,
        registryBuildId: build.registryBuildId,
      },
      sandbox.revision,
      rules,
    )
    return {
      ...installed.content,
      playerLibrary: {
        environmentId: lease.environmentId,
        draftRevision: lease.draftRevision,
        gameplayRevision: gameplay,
      },
    }
  } finally {
    // Both the Worker recipe and display locales are in memory after preparation.
    await connection.request(
      { operation: 'battle-environment-release', leaseId },
      { signal: AbortSignal.timeout(10000) },
    )
  }
}
export async function prepareContent(
  packRef: string | undefined,
  cwd: string,
  { works: workFile, npmProject, approval: approvalFile, environment, instance }: ContentSelectionOptions = {},
  signal?: AbortSignal,
): Promise<CliPreparedContent> {
  if (instance !== undefined && !environment) throw new CliError('CONTENT_OPTIONS', '--instance requires --environment')
  if (
    environment !== undefined &&
    (!environment || [packRef, workFile, npmProject, approvalFile].some(value => value !== undefined))
  )
    throw new CliError(
      'CONTENT_OPTIONS',
      '--environment requires an ID and cannot be combined with --pack-ref, --works, --npm-project or --approval',
    )
  const selected = packRef ?? 'builtin:workspace'
  const ref = /^(builtin:|npm:)/.test(selected) ? selected : resolve(cwd, selected)
  try {
    if (environment !== undefined) return await preparePlayerEnvironment(environment, instance, signal)
    if (npmProject) {
      if (workFile) throw new CliError('CONTENT_OPTIONS', '--works and --npm-project cannot be combined')
      const directory = resolve(cwd, npmProject)
      const file = approvalFile ? resolve(cwd, approvalFile) : resolve(directory, 'arcadia-admission.json')
      return (await prepareInstalled(directory, file)).content
    }
    if (approvalFile) throw new CliError('CONTENT_OPTIONS', '--approval requires --npm-project')
    if (
      !workFile &&
      !process.env.ARCADIA_PACKS_DIR?.trim() &&
      (ref === 'builtin:base' || ref === 'builtin:workspace')
    ) {
      const content = await toCliContent(await prepareShippedContent())
      const declaration = JSON.parse(
        await readFile(
          fileURLToPath(import.meta.resolve('@arcadia-eternity/data-pack-base/environment/base-rules.json')),
          'utf8',
        ),
      )
      return { ...content, rules: prepareRulesForContent(declaration, content.data).rules }
    }
    const loader = await createLoader()
    const loaded = await loader.load(ref, { source: 'node-fs', enforceLockfile: true })
    if (!workFile) return { ...loaded, rules: prepareRulesForContent(undefined, loaded.data).rules }
    const file = resolve(cwd, workFile)
    if ((await stat(file)).size > limits.bytes) throw new Error('作品文件超过大小限制')
    const archive = await parseArchive(await readFile(file, 'utf8'))
    if (!archive.selected.length) throw new Error('作品文件没有选定的发布版本；草稿须先发布')
    const selected = archive.selected.map(lock =>
      archive.releases.find(
        release =>
          release.project.id === lock.projectId &&
          release.releaseVersion === lock.version &&
          release.digest === lock.digest,
      )!,
    )
    const prepared = await loader.fromWorks(loaded.data, selected, archive.releases)
    return {
      ...loaded,
      ...prepared,
      rules: prepareRulesForContent(undefined, prepared.data).rules,
      works: { base: loaded.data, selected, installed: prepared.releases },
    }
  } catch (error) {
    if (error instanceof WorkError || error instanceof CliError) throw error
    if (environment !== undefined) {
      const code =
        error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'CONTENT_INVALID'
      throw new CliError(code, message(error), 2, environment)
    }
    throw new CliError('CONTENT_INVALID', message(error), 2, ref)
  }
}
export async function prepareRun(
  options: {
    player1?: string
    useProfile?: boolean
    profileDir?: string
    team?: string
    player2: string
    seed: string
    maxTurns: number
    maxActions: number
    teamSelection: boolean
  },
  cwd: string,
  content: Pick<ContentCatalog | ContentIndex, 'getSpecies' | 'getSkill' | 'getMark'>,
): Promise<RunSpec> {
  if (options.useProfile && options.player1)
    throw new CliError('ARGUMENT_INVALID', '--use-profile conflicts with --player1')
  if (!options.useProfile && !options.player1)
    throw new CliError('ARGUMENT_INVALID', '--player1 or --use-profile is required')
  if (options.team && !options.useProfile) throw new CliError('ARGUMENT_INVALID', '--team requires --use-profile')
  let first
  if (options.useProfile) {
    const state = await new ProfileRepository(
      new FileProfileStorage(profileDirectory(options.profileDir ? resolve(cwd, options.profileDir) : undefined)),
    ).open()
    if (!state) throw new CliError('PROFILE_EMPTY', 'Initialize or import a personal profile first')
    const index = options.team === undefined ? state.current.data.library.currentTeamIndex : Number(options.team) - 1
    if (!Number.isSafeInteger(index) || index < 0 || !state.current.data.library.teams[index])
      throw new CliError('TEAM_INVALID', 'Profile team does not exist')
    try {
      first = NativePlayerSchema.parse({
        name: state.current.data.profile.name,
        team: expandTeam(state.current.data.library, index).pets,
      })
    } catch (error) {
      throw new CliError('TEAM_INVALID', message(error))
    }
  } else first = await readTeam(resolve(cwd, options.player1!))
  const teams = [first, await readTeam(resolve(cwd, options.player2))]
  try {
    for (const team of teams)
      for (const pet of team.team) {
        content.getSpecies(pet.species as Parameters<ContentCatalog['getSpecies']>[0])
        for (const skill of pet.skills) content.getSkill(skill as Parameters<ContentCatalog['getSkill']>[0])
        for (const mark of [pet.ability, pet.emblem])
          if (mark) content.getMark(mark as Parameters<ContentCatalog['getMark']>[0])
      }
  } catch (error) {
    throw new CliError('TEAM_REFERENCE', message(error))
  }
  return {
    teams: teams as RunSpec['teams'],
    seed: options.seed,
    maxTurns: options.maxTurns,
    maxActions: options.maxActions,
    teamSelection: options.teamSelection,
  }
}
