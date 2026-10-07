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
  it.each(['standard', 'simple', 'reduced'] as const)(
    'shakes the whole camera and recoils only in standard mode (%s)',
    motion => {
      const root = document.createElement('div')
      const camera = document.createElement('div')
      const sprite = document.createElement('div')
      camera.append(root, sprite)
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
        () => sprite,
      )
      effects.showDamageMessage('left', 50)
      effects.recoilPet('left')
      const shakes = cameraTo.mock.calls.filter(([target, vars]) => target === camera && vars.repeat === 5)
      expect(shakes).toHaveLength(motion === 'standard' ? 1 : 0)
      expect(cameraTo.mock.calls.filter(([target]) => target === root)).toHaveLength(0)
      const recoil = cameraTo.mock.calls.filter(([target]) => target === sprite)
      expect(recoil).toHaveLength(motion === 'standard' ? 2 : 0)
      if (motion === 'standard') {
        expect(shakes[0][1]).toMatchObject({ x: -0.75, y: 0.375 })
        expect(recoil[0][1]).toMatchObject({ x: -18 })
        expect(recoil[1][1]).toMatchObject({ x: 0 })
      }
      effects.cleanup()
    },
  )
})
