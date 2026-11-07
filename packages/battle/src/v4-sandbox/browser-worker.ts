import { expose } from 'comlink'
import { browserSandboxStartup } from './contracts'
import { SandboxBattleRuntime } from './runtime'
import { setGlobalLogger } from '../v4/logger'
setGlobalLogger({ debug() {}, info() {}, warn: console.warn, error: console.error })
expose(new SandboxBattleRuntime(browserSandboxStartup.catalogMs))
