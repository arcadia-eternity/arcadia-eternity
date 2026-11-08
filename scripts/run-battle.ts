// Headless verification scenario, not the product CLI integration (#207).
import { runScenario } from '../packages/battle/test/engine/scenario'
import { setGlobalLogger } from '@arcadia-eternity/battle/engine'
setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} })
const result = await runScenario()
console.log(
  JSON.stringify(
    {
      engine: 'battle-core/sfc32-v1',
      turn: result.turn,
      winner: result.winner,
      checkpoints: result.checkpoints,
    },
    null,
    2,
  ),
)
