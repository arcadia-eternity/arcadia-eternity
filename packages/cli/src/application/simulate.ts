import type { NativePackLoadResult } from '@arcadia-eternity/pack-loader/native'
import type { RunOptions } from './run'
import { runBattle } from './run'
import type { RunSpec, Replay, RunResult } from './types'

export async function simulate(loaded: NativePackLoadResult, spec: RunSpec, runs: number, options: RunOptions) {
  const results: RunResult[] = [],
    replays: Replay[] = []
  for (let index = 0; index < runs; index++) {
    const effective = { ...structuredClone(spec), seed: runs === 1 ? spec.seed : `${spec.seed}/run/${index}` }
    const run = await runBattle(loaded.content, effective, options)
    results.push(run.result)
    if (options.captureReplay && run.initial)
      replays.push({
        format: 'arcadia.cli.replay',
        version: 1,
        environment: {
          build: loaded.build,
          revision: loaded.revision,
          packs: loaded.packs,
          data: structuredClone(loaded.data),
          ...(loaded.works ? { works: structuredClone(loaded.works) } : {}),
        },
        spec: effective,
        initial: run.initial,
        inputs: run.inputs,
        expected: run.result,
      })
    if (run.result.status === 'cancelled') break
  }
  const counts = { completed: 0, truncated: 0, failed: 0, cancelled: 0 }
  for (const result of results) counts[result.status]++
  return {
    report: {
      format: 'arcadia.cli.results',
      version: 1,
      seed: spec.seed,
      revision: loaded.revision,
      build: loaded.build,
      requested: runs,
      counts,
      results,
    },
    replays,
    exitCode: counts.cancelled ? 130 : counts.failed || counts.truncated ? 1 : 0,
  }
}
