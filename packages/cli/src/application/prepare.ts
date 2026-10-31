import { readFile, stat } from 'node:fs/promises'
import { parseArchive, limits, WorkError, type NativePackLoadResult } from '@arcadia-eternity/pack-loader/native'
import { resolve } from 'node:path'
import { NativeNodePackLoader, prepareNpmProject, readNpmAdmission } from '@arcadia-eternity/pack-loader/node'
import { nativeBuildIdentity } from '@arcadia-eternity/data-pack-base/build'
import { createOfficialContent, officialTemplateDefinitions } from '@arcadia-eternity/data-pack-base/native'
import type { ContentCatalog } from '@arcadia-eternity/battle/v4'
import { CliError, message } from '../reporting/errors'
import { readTeam } from '../io/files'
import type { RunSpec } from './types'

export const createLoader = () =>
  new NativeNodePackLoader(nativeBuildIdentity, createOfficialContent, { templates: officialTemplateDefinitions })
export interface ContentSelectionOptions {
  works?: string
  npmProject?: string
  approval?: string
}
export async function prepareContent(
  packRef: string,
  cwd: string,
  { works: workFile, npmProject, approval: approvalFile }: ContentSelectionOptions = {},
): Promise<NativePackLoadResult> {
  const ref = /^(builtin:|npm:)/.test(packRef) ? packRef : resolve(cwd, packRef)
  try {
    const loader = createLoader()
    const loaded = await loader.load(ref, { source: 'node-fs', enforceLockfile: true })
    if (npmProject) {
      if (workFile) throw new CliError('CONTENT_OPTIONS', '--works and --npm-project cannot be combined')
      const directory = resolve(cwd, npmProject)
      const approval = await readNpmAdmission(
        approvalFile ? resolve(cwd, approvalFile) : resolve(directory, 'arcadia-admission.json'),
      )
      const prepared = await prepareNpmProject(
        directory,
        {
          build: nativeBuildIdentity,
          base: loaded.data,
          templates: officialTemplateDefinitions,
          createContent: createOfficialContent,
        },
        approval,
      )
      return {
        ...loaded,
        ...prepared,
        // Native pack metadata uses manifests; npm presentation also includes private captured files.
        presentation: loaded.presentation,
        npm: { installationDigest: prepared.installation.digest },
      }
    }
    if (approvalFile) throw new CliError('CONTENT_OPTIONS', '--approval requires --npm-project')
    if (!workFile) return loaded
    const file = resolve(cwd, workFile)
    if ((await stat(file)).size > limits.bytes) throw new Error('作品文件超过大小限制')
    const archive = await parseArchive(await readFile(file, 'utf8'))
    if (!archive.selected.length) throw new Error('作品文件没有选定的发布版本；草稿须先发布')
    const selected = archive.selected.map(
      lock =>
        archive.releases.find(
          release =>
            release.project.id === lock.projectId &&
            release.releaseVersion === lock.version &&
            release.digest === lock.digest,
        )!,
    )
    const prepared = await loader.fromWorks(loaded.data, selected, archive.releases)
    return { ...loaded, ...prepared, works: { base: loaded.data, selected, installed: prepared.releases } }
  } catch (error) {
    if (error instanceof WorkError || error instanceof CliError) throw error
    throw new CliError('CONTENT_INVALID', message(error), 2, ref)
  }
}
export async function prepareRun(
  options: {
    player1: string
    player2: string
    seed: string
    maxTurns: number
    maxActions: number
    teamSelection: boolean
  },
  cwd: string,
  content: ContentCatalog,
): Promise<RunSpec> {
  const teams = await Promise.all([readTeam(resolve(cwd, options.player1)), readTeam(resolve(cwd, options.player2))])
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
