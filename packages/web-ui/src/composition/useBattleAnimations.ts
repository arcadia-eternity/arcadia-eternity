import { computed, h, render, type Ref, type ComputedRef } from 'vue'
import gsap from 'gsap'
import i18next from 'i18next'
import { Category, type petId } from '@arcadia-eternity/const'
import type { useBattleStore } from '@/stores/battle'
import type { AnimationGsapManager } from './animationGsapManager'
import DamageDisplay from '@/components/battle/DamageDisplay.vue'
import HealDisplay from '@/components/battle/HealDisplay.vue'

interface Player {
  activePet?: petId
}
type Side = 'left' | 'right'
type Motion = 'standard' | 'simple' | 'reduced'

/** Effects use canvas coordinates; a separate camera moves the entire scaled interface. */
export function useBattleAnimations(
  battleViewRef: Ref<HTMLElement | null>,
  store: ReturnType<typeof useBattleStore>,
  currentPlayer: ComputedRef<Player | null | undefined>,
  opponentPlayer: ComputedRef<Player | null | undefined>,
  battleViewScale: ComputedRef<number>,
  backgroundContainerRef?: Ref<HTMLElement | null>,
  getManager?: () => AnimationGsapManager | undefined,
  motion?: ComputedRef<Motion>,
  cameraRef?: Ref<HTMLElement | null>,
) {
  const mode = computed(() => motion?.value ?? 'standard')
  const hosts = new Map<HTMLElement, { side: Side; kind: string }>()
  const tweens = new Set<gsap.core.Tween | gsap.core.Timeline>()
  const hostTweens = new Map<HTMLElement, gsap.core.Timeline>()
  let backgroundAspectRatio = 1200 / 660
  const backgroundPosition = { offset: 0 }
  let backgroundTween: gsap.core.Timeline | undefined
  let id = 0
  function remove(host: HTMLElement) {
    if (!hosts.has(host)) return
    hosts.delete(host)
    const tween = hostTweens.get(host)
    hostTweens.delete(host)
    tween?.kill()
    render(null, host)
    host.remove()
    getManager?.()?.removeTempHost(host)
  }
  function timeline(host?: HTMLElement, onDone?: () => void) {
    const done = () => {
      if (host) remove(host)
      tweens.delete(tl)
      onDone?.()
    }
    const config = { onComplete: done, onInterrupt: done }
    const tl = getManager?.()?.createTimeline({ ...config, id: `battle-effect-${++id}` }) ?? gsap.timeline(config)
    tweens.add(tl)
    if (host) hostTweens.set(host, tl)
    return tl
  }
  function hostFor(side: Side, kind: string) {
    const root = battleViewRef.value
    if (!root) return null
    const matching = [...hosts].filter(([, value]) => value.side === side && value.kind === kind)
    // Bound concurrent floating numbers; retain the latest hit instead of a delayed backlog.
    if (matching.length >= 3) remove(matching[0][0])
    const host = document.createElement('div')
    host.dataset.battleEffect = kind
    root.appendChild(host)
    hosts.set(host, { side, kind })
    getManager?.()?.registerTempHost(host)
    return host
  }
  function anchor(side: Side, abovePet = false) {
    const root = battleViewRef.value
    if (abovePet) {
      return { x: (root?.offsetWidth || 1600) * (side === 'left' ? 0.34 : 0.66), y: (root?.offsetHeight || 900) * 0.28 }
    }
    return { x: (root?.offsetWidth || 1600) * (side === 'left' ? 0.27 : 0.73), y: (root?.offsetHeight || 900) * 0.4 }
  }
  function float(side: Side, kind: string, content: ReturnType<typeof h>, crit = false) {
    const host = hostFor(side, kind)
    if (!host) return
    const isDamage = kind === 'damage'
    const point = anchor(side, isDamage)
    const count = [...hosts.values()].filter(v => v.side === side && v.kind === kind).length
    render(
      h(
        'div',
        {
          style: {
            position: 'absolute',
            left: `${point.x + (count - 1) * 48}px`,
            top: `${point.y - (count - 1) * 30}px`,
            pointerEvents: 'none',
            width: 'max-content',
            zIndex: '1002',
          },
        },
        [content],
      ),
      host,
    )
    const el = host.firstElementChild as HTMLElement
    const initialScale = isDamage ? (crit ? 1.15 : 1) : 0.8
    const targetScale = isDamage ? (crit ? 1.65 : 1.35) : 1
    gsap.set(el, { xPercent: -50, yPercent: isDamage ? -50 : 0, scale: mode.value === 'reduced' ? 1 : initialScale })
    const tl = timeline(host)
    if (isDamage) {
      // Restore the original inward flight, hold, and fade. Keep the enlarged
      // graphic inside the scene now that its anchor sits above the pet.
      const halfHeight = ((el.offsetHeight || 240) * targetScale) / 2
      const rise = Math.min(150, Math.max(0, Number.parseFloat(el.style.top) - halfHeight - 16))
      tl.to(el, {
        x: mode.value === 'reduced' ? 0 : side === 'left' ? 300 : -300,
        y: mode.value === 'reduced' ? 0 : -rise,
        scale: mode.value === 'reduced' ? 1 : targetScale,
        duration: 0.25,
        ease: 'power2.out',
      })
        .to({}, { duration: 0.5 })
        .to(el, { opacity: 0, duration: 0.5, ease: 'power2.out' })
      return
    }
    tl.to(el, {
      opacity: 1,
      scale: mode.value === 'reduced' ? 1 : targetScale,
      y: mode.value === 'reduced' ? 0 : -30,
      duration: 0.16,
      ease: 'back.out(1.3)',
    })
      .to(el, { y: mode.value === 'reduced' ? 0 : -72, duration: 0.6, ease: 'power1.out' })
      .to(el, { opacity: 0, duration: 0.2 })
  }
  function flashAndShake(side: Side = 'left') {
    if (mode.value !== 'standard') return
    const host = hostFor(side, 'impact')
    if (!host) return
    const { x, y } = anchor(side)
    render(
      h(
        'svg',
        {
          viewBox: '0 0 240 240',
          width: 240,
          height: 240,
          'aria-hidden': 'true',
          style: {
            position: 'absolute',
            left: `${x - 120}px`,
            top: `${y}px`,
            pointerEvents: 'none',
            color: 'var(--battle-gold)',
            zIndex: '20',
          },
        },
        [
          h('circle', { cx: 120, cy: 120, r: 70, fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }),
          h('path', {
            d: 'M120 5v35M120 200v35M5 120h35M200 120h35M39 39l25 25M176 176l25 25M39 201l25-25M176 64l25-25',
            stroke: 'currentColor',
            'stroke-width': 3,
          }),
        ],
      ),
      host,
    )
    timeline(host).fromTo(
      host.firstElementChild,
      { scale: 0.45, opacity: 0.7 },
      { scale: 1.4, opacity: 0, duration: 0.3, ease: 'power2.out' },
    )
  }
  function shakeCamera(side: Side, intensity = 3) {
    const root = (cameraRef?.value ?? battleViewRef.value) as (HTMLElement & { _climaxShakeAnimation?: unknown }) | null
    if (mode.value !== 'standard' || !root || root._climaxShakeAnimation) return
    const amplitude = intensity * (cameraRef ? battleViewScale.value : 1)
    timeline()
      .to(root, {
        x: side === 'left' ? -amplitude : amplitude,
        y: amplitude * 0.5,
        duration: 0.04,
        repeat: 5,
        yoyo: true,
        overwrite: 'auto',
      })
      .to(root, { x: 0, y: 0, duration: 0.08 })
  }
  function updateBackgroundAspectRatio(width: number, height: number) {
    if (width > 0 && height > 0) backgroundAspectRatio = width / height
  }
  function moveBackgroundFocus(side: Side, intensity = 1) {
    const background = backgroundContainerRef?.value
    if (mode.value !== 'standard' || !background) return
    // offset sizes are logical canvas pixels, independent of viewport scale.
    const width = background.offsetWidth
    const height = background.offsetHeight
    const maxDistance = Math.max(0, (height * backgroundAspectRatio - width) / 2)
    if (maxDistance <= 0) return
    const delta = Math.min(width * 0.3, maxDistance * 0.4) * intensity
    backgroundTween?.kill()
    if (backgroundTween) tweens.delete(backgroundTween)
    const start = backgroundPosition.offset
    const target = Math.max(-maxDistance, Math.min(maxDistance, start + (side === 'left' ? delta : -delta)))
    // Animate a number, not a CSS percentage/calc pair: CSSPlugin can convert the
    // initial centered position to pixels and visibly jump on the first hit.
    const paint = () => {
      background.style.backgroundPosition = `calc(50% + ${backgroundPosition.offset}px) center`
    }
    backgroundTween = timeline()
    if (Math.abs(target - start) < 0.01 && delta > 0) {
      // A capped cumulative pan must still react to another hit. Recoil inward
      // briefly, then settle at the same edge without exposing empty scenery.
      const recoil = start - Math.sign(start) * Math.min(delta, maxDistance)
      backgroundTween
        .to(backgroundPosition, { offset: recoil, duration: 0.1, ease: 'power2.out', onUpdate: paint })
        .to(backgroundPosition, { offset: target, duration: 0.2, ease: 'power2.out', onUpdate: paint })
    } else {
      backgroundTween.to(backgroundPosition, { offset: target, duration: 0.3, ease: 'power2.out', onUpdate: paint })
    }
  }
  function showDamageMessage(
    side: Side,
    value: number,
    effectiveness: 'up' | 'normal' | 'down' = 'normal',
    crit = false,
    _skillId?: string,
  ) {
    const player = side === 'left' ? currentPlayer.value : opponentPlayer.value
    const pet = player?.activePet ? store.getPetById(player.activePet) : null
    const heavyHit = crit || !!(pet && value / pet.maxHp > 0.25)
    shakeCamera(side, heavyHit ? 20 + Math.random() * 30 : 3)
    if (mode.value === 'standard' && heavyHit) {
      flashAndShake(side)
      const hpRatio = pet && pet.maxHp > 0 ? value / pet.maxHp : 0
      moveBackgroundFocus(side, Math.min(1.5, (crit ? 1.2 : 0.8) * Math.min(hpRatio * 2, 1)))
    }
    float(
      side,
      'damage',
      h(DamageDisplay, { value, type: effectiveness === 'up' ? 'red' : effectiveness === 'down' ? 'blue' : '' }),
      crit,
    )
  }
  function showHealMessage(side: Side, value: number) {
    float(side, 'heal', h(HealDisplay, { value }))
  }
  function showMissMessage(side: Side) {
    float(
      side,
      'miss',
      h('img', {
        src: 'https://seer2-resource.yuuinih.com/png/damage/miss.png',
        style: { height: '80px', width: 'auto' },
        alt: '未命中',
      }),
    )
  }
  function showAbsorbMessage(side: Side) {
    float(
      side,
      'absorb',
      h('img', {
        src: 'https://seer2-resource.yuuinih.com/png/damage/absorb.png',
        style: { height: '80px', width: 'auto' },
        alt: '吸收',
      }),
    )
  }
  function showUseSkillMessage(side: Side, skillId: string) {
    const host = hostFor(side, 'skill')
    if (!host) return
    render(
      h(
        'div',
        {
          class: `battle-skill-callout battle-skill-callout--${side}`,
          'data-testid': 'battle-skill-callout',
          'data-side': side,
        },
        i18next.t(`${skillId}.name`, { ns: 'skill' }) || skillId,
      ),
      host,
    )
    const el = host.firstElementChild
    const offset = mode.value === 'reduced' ? 0 : side === 'left' ? -24 : 24
    timeline(host)
      .fromTo(el, { opacity: 0, x: offset }, { opacity: 1, x: 0, duration: 0.16 })
      .to({}, { duration: 1.5 })
      .to(el, { opacity: 0, x: offset, duration: 0.16 })
  }
  function playImageSkill(side: Side, category: Category) {
    let resolveHit!: () => void
    let resolveComplete!: () => void
    const hit = new Promise<void>(resolve => {
      resolveHit = resolve
    })
    const complete = new Promise<void>(resolve => {
      resolveComplete = resolve
    })
    const finish = () => {
      resolveHit()
      resolveComplete()
    }
    const status = category === Category.Status
    const host = hostFor(side, status ? 'skill-glow' : 'skill-wave')
    if (!host) {
      finish()
      return { hit, complete, cancel: finish }
    }
    const start = anchor(side)
    const end = anchor(side === 'left' ? 'right' : 'left')
    const reduced = mode.value === 'reduced'
    render(
      h(
        'svg',
        {
          viewBox: '0 0 180 180',
          width: 180,
          height: 180,
          'aria-hidden': 'true',
          style: {
            position: 'absolute',
            left: `${(reduced && !status ? end.x : start.x) - 90}px`,
            top: `${start.y - 35}px`,
            pointerEvents: 'none',
            zIndex: '20',
            color: status ? 'var(--battle-cyan)' : 'var(--battle-gold)',
            filter: 'drop-shadow(0 0 16px currentColor)',
          },
        },
        status
          ? [
              h('circle', { cx: 90, cy: 90, r: 66, fill: 'currentColor', opacity: 0.15 }),
              h('circle', { cx: 90, cy: 90, r: 60, fill: 'none', stroke: 'currentColor', 'stroke-width': 5 }),
              h('path', { d: 'M90 8v26M90 146v26M8 90h26M146 90h26', stroke: 'currentColor', 'stroke-width': 7 }),
            ]
          : [
              h('ellipse', { cx: 90, cy: 90, rx: 66, ry: 28, fill: 'currentColor', opacity: 0.35 }),
              h('ellipse', { cx: 90, cy: 90, rx: 45, ry: 18, fill: 'currentColor' }),
              h('ellipse', { cx: 90, cy: 90, rx: 25, ry: 8, fill: 'white' }),
            ],
      ),
      host,
    )
    const graphic = host.firstElementChild
    const tl = timeline(host, finish)
    tl.fromTo(graphic, { opacity: 0, scale: reduced ? 1 : 0.5 }, { opacity: 1, scale: 1, duration: 0.18 })
      .to(graphic, {
        x: status || reduced ? 0 : end.x - start.x,
        scale: status && !reduced ? 1.3 : 1,
        duration: status ? 0.45 : 0.4,
        ease: 'power2.inOut',
        onComplete: resolveHit,
      })
      .to(graphic, { opacity: 0, duration: 0.25 })
    return {
      hit,
      complete,
      cancel: () => {
        tl.kill()
        finish()
      },
    }
  }
  function reset() {
    for (const tween of [...tweens]) tween.kill()
    tweens.clear()
    for (const host of [...hosts.keys()]) remove(host)
    const camera = cameraRef?.value ?? battleViewRef.value
    if (camera) gsap.set(camera, { x: 0, y: 0 })
    backgroundPosition.offset = 0
    backgroundTween = undefined
    if (backgroundContainerRef?.value) gsap.set(backgroundContainerRef.value, { backgroundPosition: '50% center' })
  }
  return {
    showMissMessage,
    showAbsorbMessage,
    showDamageMessage,
    showHealMessage,
    showUseSkillMessage,
    playImageSkill,
    flashAndShake,
    moveBackgroundFocus,
    updateBackgroundAspectRatio,
    reset,
    cleanup: reset,
  }
}
