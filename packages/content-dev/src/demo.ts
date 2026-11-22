import { prepareContentPack, runBattle } from './testing.ts'
import { runEnvironmentDemo } from './environment-demo.ts'
import { readSourceMappings } from './preview.ts'
import { setGlobalLogger } from '@arcadia-eternity/battle/engine'
setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} })
const seed = process.env.ARCADIA_DEBUG_SEED ?? 'content-pack-template'
const sourceRoot = process.env.ARCADIA_DEBUG_ROOT ?? process.cwd()
const example = await prepareContentPack(process.cwd(), {
  environmentId: process.env.ARCADIA_DEBUG_ENVIRONMENT,
  sourceRoot,
  sources: await readSourceMappings(sourceRoot),
})
try {
  console.log(`Package: ${example.manifest.name}`)
  if (example.manifest.arcadia) console.log(`Namespace: ${example.manifest.arcadia.namespace}`)
  console.log(`Environment: ${example.environment.revision}`)
  const result =
    example.candidate.kind === 'environment'
      ? await runEnvironmentDemo(example, seed)
      : await runBattle(await example.createBattle(seed), battle => {
          const pets = [battle.playerA, battle.playerB].map(
            player =>
              `${player.name}: HP ${player.activePet.currentHp}, speed ${player.activePet.stat.spe}, marks ${player.activePet.marks.length}`,
          )
          console.log(`Turn ${battle.currentTurn}: ${pets.join(' | ')}`)
        })
  if ('status' in result && result.status !== 'completed')
    console.log(`Stopped at ${result.status} after ${result.turns} turns.`)
  else console.log(`Winner: ${result.winner ?? '—'}; finished in ${result.turns} turns.`)
  console.log(
    `ARCADIA_RESULT=${JSON.stringify({ ...result, seed, sourceRevisions: example.sourceRevisions, candidate: example.candidate, environmentRevision: example.candidate.environmentRevision, packageName: example.manifest.name, files: example.files })}`,
  )
} finally {
  await example.dispose()
}
