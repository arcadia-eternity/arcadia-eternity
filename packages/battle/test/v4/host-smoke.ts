import { createCheckpointProbe, resumeCheckpointProbe } from './snapshot-host'
export { createCheckpointProbe, resumeCheckpointProbe } from './snapshot-host'
import { runScenario, makeScenario } from './scenario'
import { Signal, GameRng, Modifier, DurationType, setGlobalLogger } from '@arcadia-eternity/battle/v4'

export async function verifyV1() {
  setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} })
  const fullBattle = await runScenario()
  const checkpoint = await resumeCheckpointProbe(await createCheckpointProbe())
  const { battle, a } = makeScenario()
  try {
    const source = new Signal(3)
    const remove = a.activePet.attributeSystem.addModifier(
      'atk',
      new Modifier(DurationType.binding, 'host-dynamic', source, 'delta', 0),
    )
    const before = a.activePet.stat.atk
    source.next(9)
    const after = a.activePet.stat.atk
    remove()
    if (after - before !== 6 || source.observerCount !== 0) throw new Error('Dynamic value/cleanup differs')
    const rng = new GameRng('host-port')
    rng.next()
    const saved = rng.getState()
    const restored = GameRng.fromState(JSON.parse(JSON.stringify(saved)))
    const continuation = Array.from({ length: 8 }, () => rng.next())
    if (continuation.some(n => n !== restored.next())) throw new Error('RNG continuation differs')
    return {
      fullBattle,
      checkpoint,
      dynamic: { before, after },
      rng: { algorithm: saved.algorithm, continuation },
    }
  } finally {
    await battle.cleanup()
  }
}
