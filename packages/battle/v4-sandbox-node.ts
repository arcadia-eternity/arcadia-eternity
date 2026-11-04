/// <reference lib="dom" preserve="true" />
import { Worker } from 'node:worker_threads'
import nodeEndpoint from 'comlink/dist/esm/node-adapter.mjs'
import { BattleWorkerManager, type BattleWorkerPolicy } from './src/v4-sandbox/worker-manager'
/** Static application Worker only. Guest modules arrive as artifact text, never Worker URLs. */
export function createNodeBattleWorkerManager(policy?: Partial<BattleWorkerPolicy>): BattleWorkerManager {
  return new BattleWorkerManager(() => {
    const worker = new Worker(new URL(import.meta.resolve('@arcadia-eternity/battle/v4/sandbox/node-worker')))
    return {
      endpoint: nodeEndpoint(worker),
      terminate: () => worker.terminate(),
      onFailure(handler) {
        const error = (value: Error) => handler(value.message),
          exit = (code: number) => handler(`Battle Worker exited (${code})`)
        worker.on('error', error)
        worker.on('exit', exit)
        return () => {
          worker.off('error', error)
          worker.off('exit', exit)
        }
      },
    }
  }, policy)
}
export { BattleWorkerManager, WorkerBattleSystem } from './src/v4-sandbox/worker-manager'
