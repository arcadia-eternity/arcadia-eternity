import { ActionState } from 'seer2-pet-animator'
import { Category } from '@arcadia-eternity/const'
import type { AnimationStateMachine } from './animationStateMachine'

export type TimeoutResult = 'completed' | 'timeout' | 'transformed' | 'defeated' | 'error'

export interface PetSpriteRef {
  getState(): Promise<ActionState | undefined | null>
}

interface EarlyTerminateCheck {
  label: string
  check: () => Promise<boolean>
  action: Exclude<TimeoutResult, 'error'>
}

export interface TimeoutConfig {
  baseTimeout: number
  extendedTimeout: number
  absoluteMaxTimeout: number
  pollInterval: number
  earlyTerminateChecks: EarlyTerminateCheck[]
}

const IDLE_STATES = new Set<ActionState>([ActionState.IDLE])

export class AnimationTimeoutManager {
  private timer: ReturnType<typeof setTimeout> | null = null
  private _isCancelled = false

  async waitForCondition(
    source: PetSpriteRef | null,
    stateMachine: AnimationStateMachine,
    config: TimeoutConfig,
  ): Promise<TimeoutResult> {
    this._isCancelled = false
    const startTime = performance.now()

    return new Promise<TimeoutResult>(resolve => {
      const safeResolve = (result: TimeoutResult) => {
        if (!this._isCancelled) {
          this._isCancelled = true
          resolve(result)
        }
      }

      const poll = async () => {
        if (this._isCancelled) return

        const elapsed = performance.now() - startTime

        if (stateMachine.isRecovering) {
          safeResolve('transformed')
          return
        }

        if (elapsed < config.baseTimeout) {
          for (const check of config.earlyTerminateChecks) {
            try {
              if (await check.check()) {
                safeResolve(check.action)
                return
              }
            } catch {}
          }
          this.timer = setTimeout(poll, config.pollInterval)
          return
        }

        if (source) {
          try {
            const currentState = await source.getState()
            if (currentState !== undefined && currentState !== null && IDLE_STATES.has(currentState)) {
              safeResolve('completed')
              return
            }
            if (currentState === ActionState.DEAD || currentState === ActionState.ABOUT_TO_DIE) {
              safeResolve('defeated')
              return
            }

            const ctx = stateMachine.snapshot()
            if (ctx.hasTransform) {
              safeResolve('transformed')
              return
            }
          } catch {
            safeResolve('transformed')
            return
          }
        } else {
          safeResolve('completed')
          return
        }

        if (elapsed >= config.absoluteMaxTimeout) {
          safeResolve('timeout')
          return
        }

        const phase2Interval = Math.min(500, config.extendedTimeout / 5)
        this.timer = setTimeout(poll, phase2Interval)
      }

      this.timer = setTimeout(poll, config.pollInterval)
    })
  }

  cancel(): void {
    this._isCancelled = true
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  static configForCategory(category: Category, hasTransform: boolean): TimeoutConfig {
    const base = category === Category.Climax ? 20000 : 5000
    const effectiveBase = hasTransform ? Math.min(base, 3000) : base

    const earlyTerminateChecks: EarlyTerminateCheck[] = []
    if (hasTransform) {
      earlyTerminateChecks.push({
        label: 'transform-detected',
        check: async () => true,
        action: 'transformed',
      })
    }

    return {
      baseTimeout: effectiveBase,
      extendedTimeout: Math.max(effectiveBase * 1.5, 3000),
      absoluteMaxTimeout: Math.max(effectiveBase * 3, 30000),
      pollInterval: 200,
      earlyTerminateChecks,
    }
  }
}
