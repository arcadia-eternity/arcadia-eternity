import gsap from 'gsap'
import { render } from 'vue'
import type { AnimationStateMachine } from './animationStateMachine'

type TweenLike = gsap.core.Tween | gsap.core.Timeline

export class AnimationGsapManager {
  private tweens = new Map<string, TweenLike>()
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
    const tl = gsap.timeline({
      ...rest,
      onComplete: () => {
        rest.onComplete?.()
        this.cleanupTween(id)
      },
      onInterrupt: () => {
        rest.onInterrupt?.()
        this.cleanupTween(id)
      },
    })
    this.tweens.set(id, tl)
    this.stateMachine?.registerTween(id)
    return tl
  }

  createTween(target: gsap.TweenTarget, config: gsap.TweenVars & { id: string }): gsap.core.Tween {
    const { id, ...rest } = config
    const tween = gsap.to(target, {
      ...rest,
      onComplete: () => {
        rest.onComplete?.()
        this.cleanupTween(id)
      },
      onInterrupt: () => {
        rest.onInterrupt?.()
        this.cleanupTween(id)
      },
    })
    this.tweens.set(id, tween)
    this.stateMachine?.registerTween(id)
    return tween
  }

  registerTempHost(host: HTMLElement): void {
    this.tempHosts.add(host)
    this.stateMachine?.incrementTempDom()
  }

  removeTempHost(host: HTMLElement): void {
    this.tempHosts.delete(host)
    this.stateMachine?.decrementTempDom()
  }

  killTween(id: string): void {
    const tween = this.tweens.get(id)
    if (!tween) return
    try {
      tween.kill()
    } catch {
      // tween may already be dead
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
