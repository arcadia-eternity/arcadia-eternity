import { ActionState } from 'seer2-pet-animator'
import { Category } from '@arcadia-eternity/const'
import type { AnimationStateMachine } from './animationStateMachine'

export type TimeoutResult = 'completed' | 'timeout' | 'transformed' | 'defeated' | 'error' | 'cancelled'

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
  private cancelWait: (() => void) | null = null

  async waitForCondition(
    source: PetSpriteRef | null,
    stateMachine: AnimationStateMachine,
    config: TimeoutConfig,
  ): Promise<TimeoutResult> {
    this.cancel()
    const startTime = performance.now()
    return new Promise<TimeoutResult>(resolve => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (result: TimeoutResult) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        clearTimeout(deadline)
        if (this.cancelWait === cancel) this.cancelWait = null
        resolve(result)
      }
      const cancel = () => finish('cancelled')
      const deadline = setTimeout(() => finish('timeout'), config.absoluteMaxTimeout)
      this.cancelWait = cancel
      const poll = async () => {
        if (settled) return
        if (stateMachine.isRecovering) return finish('transformed')
        const elapsed = performance.now() - startTime
        if (elapsed < config.baseTimeout) {
          for (const check of config.earlyTerminateChecks) {
            try {
              const matched = await check.check()
              if (settled) return
              if (matched) return finish(check.action)
            } catch {}
          }
        } else if (!source) {
          return finish('completed')
        } else {
          try {
            const current = await source.getState()
            if (settled) return
            if (stateMachine.isRecovering || stateMachine.snapshot().hasTransform) return finish('transformed')
            if (current != null && IDLE_STATES.has(current)) return finish('completed')
            if (current === ActionState.DEAD || current === ActionState.ABOUT_TO_DIE) return finish('defeated')
          } catch {
            if (!settled) finish('error')
            return
          }
        }
        if (!settled) timer = setTimeout(poll, config.pollInterval)
      }
      timer = setTimeout(poll, config.pollInterval)
    })
  }

  cancel(): void {
    this.cancelWait?.()
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
