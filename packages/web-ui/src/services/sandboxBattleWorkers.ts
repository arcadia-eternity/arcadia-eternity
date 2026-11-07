import BattleWorker from '@arcadia-eternity/battle/v4/sandbox/worker?worker'
import battleWorkerUrl from '@arcadia-eternity/battle/v4/sandbox/worker?worker&url'
import { BattleWorkerManager } from '@arcadia-eternity/battle/v4/sandbox'
import { parseBattleWorkerPolicy } from '@/config/battleWorkers'

const policy = parseBattleWorkerPolicy(import.meta.env)
let manager: BattleWorkerManager | undefined
let workerSource: Promise<void> | undefined

/** Fill the browser cache while the player is configuring the local battle. */
export function preloadBattleWorker(): void {
  workerSource ??= fetch(battleWorkerUrl)
    .then(async response => {
      if (!response.ok) throw new Error(`Battle Worker download failed: ${response.status}`)
      await response.arrayBuffer()
    })
    .catch(() => {
      workerSource = undefined
    })
}

export function getBattleWorkers(): BattleWorkerManager {
  manager ??= new BattleWorkerManager(() => {
    const worker = new BattleWorker()
    return {
      endpoint: worker,
      terminate: () => worker.terminate(),
      onFailure(handler) {
        const error = (event: ErrorEvent) => handler(event.message || '对战运行失败')
        const messageError = () => handler('对战消息无法读取')
        worker.addEventListener('error', error)
        worker.addEventListener('messageerror', messageError)
        return () => {
          worker.removeEventListener('error', error)
          worker.removeEventListener('messageerror', messageError)
        }
      },
    }
  }, policy)
  return manager
}
if (typeof window !== 'undefined')
  window.addEventListener('pagehide', () => {
    const previous = manager
    manager = undefined
    void previous?.dispose()
  })
