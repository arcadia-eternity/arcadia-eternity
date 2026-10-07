import { computed, h, render, type Ref, type ComputedRef } from 'vue'
import gsap from 'gsap'
import i18next from 'i18next'
import type { petId } from '@arcadia-eternity/const'
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
  getPetImpactTarget?: (side: Side) => HTMLElement | null,
) {
  const mode = computed(() => motion?.value ?? 'standard')
  const hosts = new Map<HTMLElement, { side: Side; kind: string }>()
  const tweens = new Set<gsap.core.Tween | gsap.core.Timeline>()
  const hostTweens = new Map<HTMLElement, gsap.core.Timeline>()
  const impactTargets = new Set<HTMLElement>()
  const impactTweens = new Map<HTMLElement, gsap.core.Timeline>()
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
  function timeline(host?: HTMLElement) {
    const done = () => {
      if (host) remove(host)
      tweens.delete(tl)
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
  function anchor(side: Side) {
    const root = battleViewRef.value
    return { x: (root?.offsetWidth || 1600) * (side === 'left' ? 0.27 : 0.73), y: (root?.offsetHeight || 900) * 0.4 }
  }
  function float(side: Side, kind: string, content: ReturnType<typeof h>, crit = false) {
    const host = hostFor(side, kind)
    if (!host) return
    const point = anchor(side)
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
    gsap.set(el, { xPercent: -50, scale: mode.value === 'reduced' ? 1 : 0.8 })
    const tl = timeline(host)
    tl.to(el, {
      opacity: 1,
      scale: mode.value !== 'reduced' && crit ? 1.35 : 1,
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
  function recoilPet(side: Side, crit = false) {
    const target = getPetImpactTarget?.(side)
    if (mode.value !== 'standard' || !target) return
    const previous = impactTweens.get(target)
    previous?.kill()
    if (previous) tweens.delete(previous)
    impactTargets.add(target)
    gsap.set(target, { x: 0 })
    const tl = timeline()
      .to(target, { x: (side === 'left' ? -1 : 1) * (crit ? 32 : 18), duration: 0.09, ease: 'power2.out' })
      .to(target, { x: 0, duration: 0.24, ease: 'power2.out' })
    impactTweens.set(target, tl)
  }
  function moveBackgroundFocus(side: Side, intensity = 1) {
    if (mode.value !== 'standard' || !backgroundContainerRef?.value) return
    timeline()
      .to(backgroundContainerRef.value, {
        backgroundPosition: `calc(50% + ${(side === 'left' ? 1 : -1) * 10 * intensity}px) center`,
        duration: 0.12,
        overwrite: true,
      })
      .to(backgroundContainerRef.value, { backgroundPosition: '50% center', duration: 0.28, ease: 'power2.out' })
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
    shakeCamera(side, heavyHit ? 6 : 3)
    if (mode.value === 'standard' && heavyHit) {
      flashAndShake(side)
      moveBackgroundFocus(side, crit ? 1.4 : 1)
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
  function reset() {
    for (const tween of [...tweens]) tween.kill()
    tweens.clear()
    for (const host of [...hosts.keys()]) remove(host)
    const camera = cameraRef?.value ?? battleViewRef.value
    if (camera) gsap.set(camera, { x: 0, y: 0 })
    for (const target of impactTargets) gsap.set(target, { x: 0 })
    impactTargets.clear()
    impactTweens.clear()
    if (backgroundContainerRef?.value) gsap.set(backgroundContainerRef.value, { backgroundPosition: '50% center' })
  }
  return {
    showMissMessage,
    showAbsorbMessage,
    showDamageMessage,
    recoilPet,
    showHealMessage,
    showUseSkillMessage,
    flashAndShake,
    moveBackgroundFocus,
    updateBackgroundAspectRatio: (_width: number, _height: number) => {},
    reset,
    cleanup: reset,
  }
}
