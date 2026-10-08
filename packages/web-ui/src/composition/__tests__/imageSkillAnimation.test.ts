import { computed, ref } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import { Category } from '@arcadia-eternity/const'
import { useBattleAnimations } from '../useBattleAnimations'
import type { useBattleStore } from '@/stores/battle'

const cleanups: (() => void)[] = []
function scene() {
  const root = document.createElement('div')
  document.body.append(root)
  const effects = useBattleAnimations(
    ref(root),
    {} as ReturnType<typeof useBattleStore>,
    computed(() => null),
    computed(() => null),
    computed(() => 1),
  )
  cleanups.push(effects.cleanup)
  return { root, effects }
}
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup())
  document.body.innerHTML = ''
})

describe('image skill playback', () => {
  it.each(['left', 'right'] as const)('lands an attack before finishing and removes the wave (%s)', async side => {
    const { root, effects } = scene()
    const playback = effects.playImageSkill(side, Category.Physical)
    let completed = false
    void playback.complete.then(() => {
      completed = true
    })
    expect(root.querySelector('[data-battle-effect="skill-wave"]')).not.toBeNull()
    await playback.hit
    expect(completed).toBe(false)
    const wave = root.querySelector('svg')!
    expect(wave.style.transform).toContain(side === 'left' ? '736' : '-736')
    await playback.complete
    expect(root.children).toHaveLength(0)
  })

  it('keeps the attribute glow next to the user and releases playback on cleanup', async () => {
    const { root, effects } = scene()
    const playback = effects.playImageSkill('left', Category.Status)
    expect(root.querySelector('[data-battle-effect="skill-glow"]')).not.toBeNull()
    effects.reset()
    await Promise.all([playback.hit, playback.complete])
    expect(root.children).toHaveLength(0)
  })

  it('can cancel a wave without hanging either hit or completion', async () => {
    const { root, effects } = scene()
    const playback = effects.playImageSkill('right', Category.Special)
    playback.cancel()
    playback.cancel()
    await Promise.all([playback.hit, playback.complete])
    expect(root.children).toHaveLength(0)
  })
})
