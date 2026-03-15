export type AppInitPhase = 'pre-init' | 'data-ready' | 'identity-ready' | 'network-ready' | 'post-init'

export interface AppInitHook {
  name: string
  phase: AppInitPhase
  run: () => void | Promise<void>
  critical?: boolean
  order?: number
}

export interface AppInitHookFailure {
  hook: AppInitHook
  error: unknown
}

const PHASE_ORDER: AppInitPhase[] = ['pre-init', 'data-ready', 'identity-ready', 'network-ready', 'post-init']

export class AppBootstrap {
  private readonly hooks: AppInitHook[] = []

  register(hook: AppInitHook): void {
    this.hooks.push(hook)
  }

  async runPhase(phase: AppInitPhase): Promise<AppInitHookFailure[]> {
    const phaseHooks = this.hooks
      .filter(hook => hook.phase === phase)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

    const failures: AppInitHookFailure[] = []

    for (const hook of phaseHooks) {
      try {
        await hook.run()
      } catch (error) {
        failures.push({ hook, error })
        if (hook.critical !== false) {
          throw error
        }
      }
    }

    return failures
  }

  async runAll(): Promise<AppInitHookFailure[]> {
    const failures: AppInitHookFailure[] = []
    for (const phase of PHASE_ORDER) {
      failures.push(...(await this.runPhase(phase)))
    }
    return failures
  }
}

export function createAppBootstrap(): AppBootstrap {
  return new AppBootstrap()
}
