import { computed, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useBattleAnimations } from '../useBattleAnimations'
import type { useBattleStore } from '@/stores/battle'

const cameraTo = vi.hoisted(() => vi.fn())
const effectSet = vi.hoisted(() => vi.fn())
vi.mock('gsap', () => ({
  default: {
    set: effectSet,
    timeline: () => {
      const tween = {
        to: (target: unknown, vars: unknown) => {
          cameraTo(target, vars)
          const animation = vars as { offset?: number; onUpdate?: () => void }
          if (animation.offset !== undefined) {
            ;(target as { offset: number }).offset = animation.offset
            animation.onUpdate?.()
          }
          return tween
        },
        fromTo: () => tween,
        kill: vi.fn(),
      }
      return tween
    },
  },
}))
afterEach(() => {
  document.body.innerHTML = ''
  cameraTo.mockClear()
  effectSet.mockClear()
})
describe('floating effects canvas coordinates', () => {
  it.each([
    ['left', false, 300, -74],
    ['right', false, -300, -74],
    ['left', true, 300, -38],
    ['right', true, -300, -38],
  ] as const)('flies damage inward, holds, and fades (%s, crit=%s)', (side, crit, x, y) => {
    const root = document.createElement('div')
    document.body.append(root)
    const effects = useBattleAnimations(
      ref(root),
      {} as ReturnType<typeof useBattleStore>,
      computed(() => null),
      computed(() => null),
      computed(() => 1),
    )
    effects.showDamageMessage(side, 123, 'normal', crit)
    const graphic = root.querySelector('[data-battle-effect="damage"]')!.firstElementChild
    const phases = cameraTo.mock.calls.filter(([target]) => target === graphic)
    expect(phases[0][1]).toMatchObject({ x, duration: 0.25, ease: 'power2.out' })
    expect(phases[0][1].y).toBeCloseTo(y)
    expect(cameraTo.mock.calls).toContainEqual([{}, { duration: 0.5 }])
    expect(phases[1][1]).toMatchObject({ opacity: 0, duration: 0.5, ease: 'power2.out' })
    effects.cleanup()
  })
  it.each([
    ['standard', false, 1.35],
    ['standard', true, 1.65],
    ['simple', false, 1.35],
    ['simple', true, 1.65],
    ['reduced', false, 1],
    ['reduced', true, 1],
  ] as const)('scales the entire damage graphic in %s mode (crit=%s)', (motion, crit, expectedScale) => {
    const root = document.createElement('div')
    document.body.append(root)
    const effects = useBattleAnimations(
      ref(root),
      {} as ReturnType<typeof useBattleStore>,
      computed(() => null),
      computed(() => null),
      computed(() => 1),
      undefined,
      undefined,
      computed(() => motion),
    )
    effects.showDamageMessage('left', 123, 'normal', crit)
    const graphic = root.querySelector('[data-battle-effect="damage"]')!.firstElementChild
    const animation = cameraTo.mock.calls.find(([target, vars]) => target === graphic && 'scale' in vars)?.[1]
    expect(animation).toMatchObject({
      scale: expectedScale,
    })
    if (motion === 'reduced') expect(animation).toMatchObject({ x: 0, y: 0 })
    expect(graphic?.querySelector('.battle-damage__background')).not.toBeNull()
    expect(graphic?.querySelector('.battle-damage__digit')).not.toBeNull()
    effects.cleanup()
  })
  it.each([
    [0.25, 'left', '544px'],
    [0.25, 'right', '1056px'],
    [1, 'left', '544px'],
    [1, 'right', '1056px'],
    [1.5, 'left', '544px'],
    [1.5, 'right', '1056px'],
  ] as const)('anchors damage above and inward under viewport scale %s (%s)', (scale, side, expectedLeft) => {
    const root = document.createElement('div')
    root.style.transform = `scale(${scale})`
    Object.defineProperties(root, { offsetWidth: { value: 1600 }, offsetHeight: { value: 900 } })
    document.body.append(root)
    const store = { getPetById: () => ({ maxHp: 500 }) } as unknown as ReturnType<typeof useBattleStore>
    const effects = useBattleAnimations(
      ref(root),
      store,
      computed(() => null),
      computed(() => null),
      computed(() => scale),
    )
    effects.showDamageMessage(side, 123)
    const host = root.querySelector('[data-battle-effect="damage"]')!
    const number = host.firstElementChild as HTMLElement
    expect(number.style.left).toBe(expectedLeft)
    expect(Number.parseFloat(number.style.top)).toBeCloseTo(252)
    expect(effectSet).toHaveBeenCalledWith(number, expect.objectContaining({ xPercent: -50, yPercent: -50 }))
    expect(number.style.width).toBe('max-content')
    expect(host.querySelector('[aria-label="伤害 123"]')).not.toBeNull()
    effects.cleanup()
    expect(root.children).toHaveLength(0)
  })
  it.each(['standard', 'simple', 'reduced'] as const)('shakes the whole camera only in standard mode (%s)', motion => {
    const root = document.createElement('div')
    const camera = document.createElement('div')
    camera.append(root)
    document.body.append(camera)
    const store = { getPetById: () => ({ maxHp: 500 }) } as unknown as ReturnType<typeof useBattleStore>
    const effects = useBattleAnimations(
      ref(root),
      store,
      computed(() => null),
      computed(() => null),
      computed(() => 0.25),
      undefined,
      undefined,
      computed(() => motion),
      ref(camera),
    )
    effects.showDamageMessage('left', 50)
    const shakes = cameraTo.mock.calls.filter(([target, vars]) => target === camera && vars.repeat === 5)
    expect(shakes).toHaveLength(motion === 'standard' ? 1 : 0)
    expect(cameraTo.mock.calls.filter(([target]) => target === root)).toHaveLength(0)
    if (motion === 'standard') {
      expect(shakes[0][1]).toMatchObject({ x: -0.75, y: 0.375 })
    }
    effects.cleanup()
  })
})

it.each([0.25, 1, 1.5])('preserves cumulative background drift and image edges under scale %s', scale => {
  const root = document.createElement('div')
  const background = document.createElement('div')
  Object.defineProperties(background, { offsetWidth: { value: 1600 }, offsetHeight: { value: 900 } })
  const effects = useBattleAnimations(
    ref(root),
    {} as ReturnType<typeof useBattleStore>,
    computed(() => null),
    computed(() => null),
    computed(() => scale),
    ref(background),
  )
  effects.updateBackgroundAspectRatio(2400, 900)
  effects.moveBackgroundFocus('left')
  effects.moveBackgroundFocus('left')
  effects.moveBackgroundFocus('left')
  effects.moveBackgroundFocus('right')
  const drift = cameraTo.mock.calls.filter(([, vars]) => 'offset' in vars)
  expect(drift.map(([, vars]) => vars.offset)).toEqual([160, 320, 400, 240])
  expect(drift[0][1]).toMatchObject({ duration: 0.3, ease: 'power2.out' })
  effects.reset()
  cameraTo.mockClear()
  effects.moveBackgroundFocus('right')
  expect(cameraTo.mock.calls[0][1].offset).toBe(-160)
  effects.cleanup()
})
