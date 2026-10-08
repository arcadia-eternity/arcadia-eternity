import gsap from 'gsap'
import { render } from 'vue'
import type { AnimationStateMachine } from './animationStateMachine'

type TweenLike = gsap.core.Tween | gsap.core.Timeline

export class AnimationGsapManager {
  private tweens = new Map<string, TweenLike>()
  private settlements = new Map<string, () => void>()
  private tempHosts = new Set<HTMLElement>()
  private stateMachine: AnimationStateMachine | null = null

  attach(stateMachine: AnimationStateMachine): void {
    this.stateMachine = stateMachine
  }

  private cleanupTween(id: string): void {
    this.tweens.delete(id)
    this.stateMachine?.unregisterTween(id)
  }

  createTimeline(config: gsap.TimelineVars & { id: string }): gsap.core.Timeline {
    const { id, ...rest } = config
    this.killTween(id)
    let settled = false
    const cleanup = () => {
      settled = true
      this.cleanupTween(id)
    }
    const animation = gsap.timeline({
      ...rest,
      onComplete: () => {
        try {
          rest.onComplete?.()
        } finally {
          cleanup()
        }
      },
      onInterrupt: () => {
        try {
          rest.onInterrupt?.()
        } finally {
          cleanup()
        }
      },
    })
    if (!settled) {
      this.tweens.set(id, animation)
      this.stateMachine?.registerTween(id)
    }
    return animation
  }

  createTween(target: gsap.TweenTarget, config: gsap.TweenVars & { id: string }): gsap.core.Tween {
    const { id, ...rest } = config
    this.killTween(id)
    let settled = false
    const cleanup = () => {
      settled = true
      this.cleanupTween(id)
    }
    const animation = gsap.to(target, {
      ...rest,
      onComplete: () => {
        try {
          rest.onComplete?.()
        } finally {
          cleanup()
        }
      },
      onInterrupt: () => {
        try {
          rest.onInterrupt?.()
        } finally {
          cleanup()
        }
      },
    })
    if (!settled) {
      this.tweens.set(id, animation)
      this.stateMachine?.registerTween(id)
    }
    return animation
  }

  /** GSAP's own thenable never resolves on kill. Page tasks await this instead. */
  createTweenPlayback(target: gsap.TweenTarget, config: gsap.TweenVars & { id: string }) {
    let finish!: (result: 'completed' | 'cancelled') => void
    let settled = false
    const finished = new Promise<'completed' | 'cancelled'>(resolve => {
      finish = result => {
        if (settled) return
        settled = true
        this.settlements.delete(config.id)
        resolve(result)
      }
    })
    const tween = this.createTween(target, {
      ...config,
      onComplete: () => {
        try {
          config.onComplete?.()
        } finally {
          finish('completed')
        }
      },
      onInterrupt: () => {
        try {
          config.onInterrupt?.()
        } finally {
          finish('cancelled')
        }
      },
    })
    if (!settled) this.settlements.set(config.id, () => finish('cancelled'))
    return { tween, finished }
  }

  registerTempHost(host: HTMLElement): void {
    if (this.tempHosts.has(host)) return
    this.tempHosts.add(host)
    this.stateMachine?.incrementTempDom()
  }

  removeTempHost(host: HTMLElement): void {
    if (this.tempHosts.delete(host)) this.stateMachine?.decrementTempDom()
  }

  killTween(id: string): void {
    const tween = this.tweens.get(id)
    if (!tween) return
    try {
      tween.kill()
    } catch {
      // tween may already be dead
    } finally {
      this.settlements.get(id)?.()
      this.cleanupTween(id)
    }
  }

  killAll(): void {
    for (const [id] of this.tweens) {
      this.killTween(id)
    }
    this.tweens.clear()

    for (const host of this.tempHosts) {
      try {
        const parent = host.parentElement
        render(null, host)
        if (parent) {
          parent.removeChild(host)
        }
      } catch {
        // DOM may already be detached
      }
      this.stateMachine?.decrementTempDom()
    }
    this.tempHosts.clear()
  }

  getActiveCount(): number {
    return this.tweens.size
  }

  isAnyActive(): boolean {
    return this.tweens.size > 0
  }

  reset(): void {
    this.killAll()
    this.tempHosts.clear()
  }
}
