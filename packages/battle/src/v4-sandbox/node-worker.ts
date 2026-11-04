import { parentPort } from 'node:worker_threads'
import { expose } from 'comlink'
import nodeEndpoint from 'comlink/dist/esm/node-adapter.mjs'
import { SandboxBattleRuntime } from './runtime'
import { setGlobalLogger } from '../v4/logger'
if (!parentPort) throw Error('Battle runtime requires a dedicated Worker')
setGlobalLogger({ debug() {}, info() {}, warn: console.warn, error: console.error })
expose(new SandboxBattleRuntime(), nodeEndpoint(parentPort))
