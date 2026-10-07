import { computed, ref } from 'vue'
import { afterEach, expect, it } from 'vitest'
import gsap from 'gsap'
import { useBattleAnimations } from '../useBattleAnimations'
import type { useBattleStore } from '@/stores/battle'

afterEach(() => {
  gsap.globalTimeline.clear()
  document.body.innerHTML = ''
})
it('starts the first hit at the centered background and interpolates subsequent hits', () => {
  const background = document.createElement('div')
  // Browser computed style for the battle stylesheet's background-position: center.
  background.style.backgroundPosition = '50% 50%'
  Object.defineProperties(background, { offsetWidth: { value: 1600 }, offsetHeight: { value: 900 } })
  document.body.append(background)
  const effects = useBattleAnimations(
    ref(background),
    {} as ReturnType<typeof useBattleStore>,
    computed(() => null),
    computed(() => null),
    computed(() => 1),
    ref(background),
  )
  effects.updateBackgroundAspectRatio(2400, 900)
  effects.moveBackgroundFocus('left')
  const tween = gsap.globalTimeline.getChildren(false, false, true).at(-1)!
  tween.pause().progress(0.001)
  const offset = Number(background.style.backgroundPosition.match(/\+\s*([\d.-]+)px/)?.[1])
  expect(offset).toBeGreaterThanOrEqual(0)
  expect(offset).toBeLessThan(2)
  tween.progress(1)
  expect(background.style.backgroundPosition).toBe('calc(50% + 160px) center')
  effects.moveBackgroundFocus('right')
  const second = gsap.globalTimeline.getChildren(false, false, true).at(-1)!
  second.pause().progress(0.5)
  const middle = Number(background.style.backgroundPosition.match(/\+\s*([\d.-]+)px/)?.[1])
  expect(middle).toBeGreaterThan(0)
  expect(middle).toBeLessThan(160)
  second.progress(1)
  expect(background.style.backgroundPosition).toBe('calc(50% + 0px) center')
  effects.cleanup()
})

it('keeps responding at the scenery edge and resumes interrupted pans from the rendered position', () => {
  const background = document.createElement('div')
  Object.defineProperties(background, { offsetWidth: { value: 1600 }, offsetHeight: { value: 900 } })
  document.body.append(background)
  const effects = useBattleAnimations(
    ref(background),
    {} as ReturnType<typeof useBattleStore>,
    computed(() => null),
    computed(() => null),
    computed(() => 1),
    ref(background),
  )
  effects.updateBackgroundAspectRatio(1200, 660)
  const edge = ((900 * 1200) / 660 - 1600) / 2
  const finish = () => gsap.globalTimeline.getChildren(false, false, true).at(-1)!.pause().progress(1)
  for (let hit = 0; hit < 3; hit++) {
    effects.moveBackgroundFocus('left')
    finish()
  }
  const offset = () => Number(background.style.backgroundPosition.match(/\+\s*([\d.-]+)px/)?.[1])
  expect(offset()).toBeCloseTo(edge, 3)
  for (let hit = 0; hit < 3; hit++) {
    effects.moveBackgroundFocus('left')
    const recoil = gsap.globalTimeline.getChildren(false, false, true).at(-1)!.pause()
    recoil.time(0.1)
    expect(offset()).toBeLessThan(edge - 1)
    expect(offset()).toBeGreaterThanOrEqual(-edge)
    recoil.progress(1)
    expect(offset()).toBeCloseTo(edge, 3)
  }
  effects.reset()
  effects.moveBackgroundFocus('left')
  gsap.globalTimeline.getChildren(false, false, true).at(-1)!.pause().progress(0.5)
  const interrupted = offset()
  effects.moveBackgroundFocus('right')
  const reverse = gsap.globalTimeline.getChildren(false, false, true).at(-1)!.pause()
  reverse.progress(0.001)
  expect(Math.abs(offset() - interrupted)).toBeLessThan(0.1)
  reverse.progress(1)
  effects.cleanup()
})
