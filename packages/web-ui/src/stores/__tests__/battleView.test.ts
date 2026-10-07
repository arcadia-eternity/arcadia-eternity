import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useBattleViewStore } from '../battleView'

describe('unified battle canvas scaling', () => {
  beforeEach(() => setActivePinia(createPinia()))
  for (const [width, height] of [
    [1280, 660],
    [390, 788],
    [844, 334],
    [280, 500],
  ]) {
    it(`fits every control into ${width} × ${height} without cropping`, () => {
      const view = useBattleViewStore()
      view.setAdaptiveScaling(true)
      view.setContainerSize(width, height)
      expect(view.scale).toBeCloseTo(Math.min(width / 1600, height / 900))
      expect(1600 * view.scale).toBeLessThanOrEqual(width)
      expect(900 * view.scale).toBeLessThanOrEqual(height)
    })
  }
})
