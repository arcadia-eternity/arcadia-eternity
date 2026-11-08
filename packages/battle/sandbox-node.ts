/// <reference lib="dom" preserve="true" />
import { Worker } from 'node:worker_threads'
import nodeEndpoint from 'comlink/dist/esm/node-adapter.mjs'
import { BattleWorkerManager, type BattleWorkerPolicy } from './src/sandbox/worker-manager'
/** Static application Worker only. Guest modules arrive as artifact text, never Worker URLs. */
export function createNodeBattleWorkerManager(policy?: Partial<BattleWorkerPolicy>): BattleWorkerManager {
  return new BattleWorkerManager(() => {
    const worker = new Worker(new URL('./sandbox-node-worker.js', import.meta.url))
    return {
      endpoint: nodeEndpoint(worker),
      terminate: () => worker.terminate(),
      setIdle: idle => {
        if (idle) worker.unref()
        else worker.ref()
      },
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
export {
  BattleWorkerManager,
  WorkerBattleSystem,
  BattleWorkerAdmissionError,
  type BattleWorkerAdmissionReason,
  type BattleWorkerPolicy,
  type BattleWorkerPoolStatus,
} from './src/sandbox/worker-manager'
