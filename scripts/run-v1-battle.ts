// Headless verification scenario, not the product CLI integration (#207).
import { runHistoricalOfficial } from '../packages/battle/test/v4/official'
import { setGlobalLogger } from '@arcadia-eternity/battle/v4'
setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} })
const result = await runHistoricalOfficial()
console.log(
  JSON.stringify(
    {
      engine: 'v1-port/sfc32-v1',
      turn: result.turn,
      winner: result.winner,
      content: result.content,
      acceptedActions: result.indexes,
      checkpoints: result.checkpoints,
    },
    null,
    2,
  ),
)
