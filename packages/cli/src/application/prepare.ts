import { resolve } from 'node:path'
import { NativeNodePackLoader } from '@arcadia-eternity/pack-loader/node'
import { nativeBuildIdentity } from '@arcadia-eternity/data-pack-base/build'
import { createOfficialContent } from '@arcadia-eternity/data-pack-base/native'
import type { ContentCatalog } from '@arcadia-eternity/battle/v4'
import { CliError, message } from '../reporting/errors'
import { readTeam } from '../io/files'
import type { RunSpec } from './types'

export const createLoader = () => new NativeNodePackLoader(nativeBuildIdentity, createOfficialContent)
export async function prepareContent(packRef: string, cwd: string) {
  const ref = /^(builtin:|npm:)/.test(packRef) ? packRef : resolve(cwd, packRef)
  try {
    return await createLoader().load(ref, { source: 'node-fs', enforceLockfile: true })
  } catch (error) {
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
