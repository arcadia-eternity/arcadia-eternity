import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { parse } from 'yaml'
import { compileEffectModule } from '@arcadia-eternity/pack-loader/node'
import { createNodeBattleWorkerManager } from '@arcadia-eternity/battle/sandbox/node'
import { officialEffectIds } from '@arcadia-eternity/data-pack-base/metadata'

// Run after pnpm build:package. Sequential runs avoid competition between modes.
const rounds = Number(process.argv[2] ?? 3)
if (!Number.isSafeInteger(rounds) || rounds < 2 || rounds > 30) throw Error('Expected 2–30 rounds')
const root = new URL('../', import.meta.url)
const base = new URL('packs/base/', root)
const manifest = JSON.parse(await readFile(new URL('pack.json', base), 'utf8'))
const read = async kind =>
  (
    await Promise.all(
      manifest.data[kind].map(async file =>
        parse(await readFile(new URL(`data/${file}`, base), 'utf8'), { merge: true }),
      ),
    )
  ).flat()
const artifact = await compileEffectModule(
  fileURLToPath(new URL('dist/effects.js', base)),
  fileURLToPath(root),
  '@arcadia-eternity/data-pack-base',
)
const environment = {
  revision: 'benchmark/official-effects',
  data: {
    marks: await read('marks'),
    skills: await read('skills'),
    species: await read('species'),
  },
  modules: [{ artifact, namespace: '', role: 'catalog' }],
}
const fixture = JSON.parse(
  await readFile(new URL('packages/battle/test/fixtures/official-switch.input.json', root), 'utf8'),
)
const samples = []
let expected
for (const mode of ['dedicated', 'pooled']) {
  const manager = createNodeBattleWorkerManager({
    maxBattles: 1,
    cleanupMs: 5000,
    reuseWorkers: mode === 'pooled',
    vmGrouping: mode === 'pooled' ? 'environment' : 'package',
  })
  try {
    for (let round = 0; round < rounds; round++) {
      const started = performance.now()
      const battle = await manager.create({
        environment,
        players: structuredClone(fixture.teams),
        options: { rngSeed: fixture.seed, timerConfig: { enabled: false } },
      })
      const created = performance.now()
      await battle.ready()
      await battle.waitForPendingDecision()
      const state = await battle.getState(undefined, true)
      const summary = {
        turn: state.currentTurn,
        phase: state.currentPhase,
        status: state.status,
        players: state.players.map(player => ({
          rage: player.rage,
          team: player.team.map(pet => ({
            hp: pet.currentHp,
            marks: pet.marks.map(mark => [mark.baseId, mark.stack]),
          })),
        })),
      }
      expected ??= summary
      assert.deepEqual(summary, expected, 'A reused worker must start with the same battle state')
      const ready = performance.now()
      const workerId = manager.status().at(-1).workerId
      const previous = samples.at(-1)
      if (previous?.mode === mode) {
        if (mode === 'pooled') assert.equal(workerId, previous.workerId, 'Expected the prepared worker to be reused')
        else assert.notEqual(workerId, previous.workerId, 'Dedicated mode must create a new worker')
      }
      await battle.cleanup()
      samples.push({
        mode,
        round,
        workerId,
        createMs: Math.round(created - started),
        playableMs: Math.round(ready - started),
        cleanupMs: Math.round(performance.now() - ready),
      })
    }
  } finally {
    await manager.dispose()
  }
}
console.log(
  JSON.stringify(
    { effects: officialEffectIds.length, sourceBytes: Buffer.byteLength(artifact.source), samples },
    null,
    2,
  ),
)
