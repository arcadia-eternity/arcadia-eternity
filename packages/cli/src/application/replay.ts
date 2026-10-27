import { isDeepStrictEqual } from 'node:util'
import { nativeBuildIdentity } from '@arcadia-eternity/data-pack-base/build'
import { NativePlayerSchema } from '@arcadia-eternity/battle/v4'
import { createLoader } from './prepare'
import { runBattle } from './run'
import { CliError, message } from '../reporting/errors'
import type { Replay } from './types'
import type { NativePackLoadResult } from '@arcadia-eternity/pack-loader/native'

function validate(value: unknown): asserts value is Replay {
  const r = value as Replay | null
  if (
    !r ||
    r.format !== 'arcadia.cli.replay' ||
    r.version !== 1 ||
    !r.environment ||
    !r.spec ||
    !r.initial ||
    !Array.isArray(r.inputs) ||
    !r.expected
  )
    throw new CliError('REPLAY_FORMAT', 'Unsupported or incomplete CLI replay', 3)
  if (
    !Array.isArray(r.spec.teams) ||
    r.spec.teams.length !== 2 ||
    typeof r.spec.seed !== 'string' ||
    typeof r.spec.teamSelection !== 'boolean' ||
    ![r.spec.maxTurns, r.spec.maxActions].every(n => Number.isSafeInteger(n) && n > 0)
  )
    throw new CliError('REPLAY_SPEC', 'Invalid replay inputs or limits', 3)
  r.spec.teams.forEach(team => NativePlayerSchema.parse(team))
  if (
    !Array.isArray(r.environment.packs) ||
    r.environment.packs.some(pack => !pack || typeof pack.id !== 'string' || typeof pack.version !== 'string')
  )
    throw new CliError('REPLAY_ENVIRONMENT', 'Invalid replay pack identities', 3)
  if (!['completed', 'truncated'].includes(r.expected.status))
    throw new CliError('REPLAY_INCOMPLETE', 'Only completed or deterministically truncated runs can be verified', 3)
}
function firstDifference(actual: unknown, expected: unknown, path = 'result'): string | undefined {
  if (isDeepStrictEqual(actual, expected)) return undefined
  if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
    for (const key of new Set([...Object.keys(actual), ...Object.keys(expected)])) {
      const difference = firstDifference(
        (actual as Record<string, unknown>)[key],
        (expected as Record<string, unknown>)[key],
        `${path}.${key}`,
      )
      if (difference) return difference
    }
  }
  return path
}
export async function replay(value: unknown, signal: AbortSignal, npmEnvironment?: NativePackLoadResult) {
  try {
    validate(value)
    if (value.environment.npm && (!npmEnvironment || !isDeepStrictEqual(value.environment.npm, npmEnvironment.npm)))
      throw new CliError(
        'REPLAY_NPM',
        'Replay requires the original separately installed and approved npm environment',
        3,
      )
    if (!value.environment.npm && npmEnvironment)
      throw new CliError('REPLAY_NPM', 'This replay does not use an npm environment', 3)
    if (!isDeepStrictEqual(value.environment.build, npmEnvironment?.build ?? nativeBuildIdentity))
      throw new CliError('REPLAY_BUILD', 'Replay requires a different trusted build', 3)
    const works = value.environment.works
    const loaded =
      npmEnvironment ??
      (works
        ? await createLoader().fromWorks(works.base, works.selected, works.installed)
        : await createLoader().fromMetadata(value.environment.data, {
            packs: value.environment.packs,
            expectedRevision: value.environment.revision,
          }))
    if (loaded.revision !== value.environment.revision)
      throw new CliError('REPLAY_ENVIRONMENT', 'Replay environment revision mismatch', 3)
    if ((works || npmEnvironment) && (!('data' in loaded) || !isDeepStrictEqual(loaded.data, value.environment.data)))
      throw new CliError('REPLAY_ENVIRONMENT', 'Replay compiled data mismatch', 3)
    const run = await runBattle(loaded.content, value.spec, {
      signal,
      replay: { initial: value.initial, inputs: value.inputs },
    })
    if (run.result.status === 'cancelled')
      return {
        report: { format: 'arcadia.cli.replay-result', version: 1, verified: false, result: run.result },
        exitCode: 130,
      }
    const difference = firstDifference(run.result, value.expected)
    if (difference) throw new CliError('REPLAY_RESULT', `Replay differs at ${difference}`, 3)
    return {
      report: { format: 'arcadia.cli.replay-result', version: 1, verified: true, result: run.result },
      exitCode: 0,
    }
  } catch (error) {
    if (error instanceof CliError) throw error
    throw new CliError('REPLAY_INVALID', message(error), 3)
  }
}
