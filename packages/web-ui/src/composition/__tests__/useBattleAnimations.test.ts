import { computed, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useBattleAnimations } from '../useBattleAnimations'
import type { useBattleStore } from '@/stores/battle'

const cameraTo = vi.hoisted(() => vi.fn())
vi.mock('gsap', () => ({
  default: {
    set: vi.fn(),
    timeline: () => {
      const tween = {
        to: (target: unknown, vars: unknown) => {
          cameraTo(target, vars)
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
})
describe('floating effects canvas coordinates', () => {
  it.each([0.25, 1, 1.5])('anchors damage in canvas pixels under viewport scale %s', scale => {
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
    effects.showDamageMessage('right', 123)
    const host = root.querySelector('[data-battle-effect="damage"]')!
    const number = host.firstElementChild as HTMLElement
    expect(number.style.left).toBe('1168px')
    expect(number.style.top).toBe('360px')
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
  const drift = cameraTo.mock.calls.filter(([target]) => target === background)
  expect(drift.map(([, vars]) => vars.backgroundPosition)).toEqual([
    'calc(50% + 160px) center',
    'calc(50% + 320px) center',
    'calc(50% + 400px) center',
    'calc(50% + 240px) center',
  ])
  expect(drift[0][1]).toMatchObject({ duration: 0.3, ease: 'power2.out' })
  effects.reset()
  cameraTo.mockClear()
  effects.moveBackgroundFocus('right')
  expect(cameraTo.mock.calls[0][1].backgroundPosition).toBe('calc(50% + -160px) center')
  effects.cleanup()
})
