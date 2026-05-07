import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AnimationTimeoutManager, type TimeoutConfig, type PetSpriteRef } from '../animationTimeout'
import { AnimationStateMachine, AnimationState } from '../animationStateMachine'
import { ActionState } from 'seer2-pet-animator'
import { Category } from '@arcadia-eternity/const'

function createMockSource(state: ActionState | undefined | null = ActionState.IDLE): PetSpriteRef {
  return { getState: vi.fn().mockResolvedValue(state) }
}

function createMockStateMachine(opts: { isRecovering?: boolean; hasTransform?: boolean } = {}): AnimationStateMachine {
  return {
    get isRecovering() {
      return opts.isRecovering ?? false
    },
    snapshot: vi.fn().mockReturnValue({ hasTransform: opts.hasTransform ?? false }),
  } as unknown as AnimationStateMachine
}

function makeConfig(overrides: Partial<TimeoutConfig> = {}): TimeoutConfig {
  return {
    baseTimeout: 100,
    extendedTimeout: 150,
    absoluteMaxTimeout: 300,
    pollInterval: 10,
    earlyTerminateChecks: [],
    ...overrides,
  }
}

describe('AnimationTimeoutManager', () => {
  let manager: AnimationTimeoutManager

  beforeEach(() => {
    manager = new AnimationTimeoutManager()
  })

  afterEach(() => {
    vi.useRealTimers()
    manager.cancel()
  })

  describe('waitForCondition', () => {
    it('returns completed when source is null', async () => {
      vi.useFakeTimers()
      const sm = createMockStateMachine()
      const promise = manager.waitForCondition(null, sm, makeConfig())
      await vi.advanceTimersByTimeAsync(200)
      expect(await promise).toBe('completed')
    })

    it('returns completed when PetSpriteRef getState returns IDLE', async () => {
      vi.useFakeTimers()
      const source = createMockSource(ActionState.IDLE)
      const sm = createMockStateMachine()
      const promise = manager.waitForCondition(source, sm, makeConfig())
      await vi.advanceTimersByTimeAsync(200)
      expect(await promise).toBe('completed')
    })

    it('returns defeated when getState returns DEAD', async () => {
      vi.useFakeTimers()
      const source = createMockSource(ActionState.DEAD)
      const sm = createMockStateMachine()
      const promise = manager.waitForCondition(source, sm, makeConfig())
      await vi.advanceTimersByTimeAsync(200)
      expect(await promise).toBe('defeated')
    })

    it('returns defeated when getState returns ABOUT_TO_DIE', async () => {
      vi.useFakeTimers()
      const source = createMockSource(ActionState.ABOUT_TO_DIE)
      const sm = createMockStateMachine()
      const promise = manager.waitForCondition(source, sm, makeConfig())
      await vi.advanceTimersByTimeAsync(200)
      expect(await promise).toBe('defeated')
    })

    it('returns timeout after absoluteMaxTimeout', async () => {
      vi.useFakeTimers()
      const source = createMockSource(ActionState.ATK_PHY)
      const sm = createMockStateMachine()
      const config = makeConfig({ absoluteMaxTimeout: 200 })
      const promise = manager.waitForCondition(source, sm, config)
      await vi.advanceTimersByTimeAsync(400)
      expect(await promise).toBe('timeout')
    })

    it('returns transformed when stateMachine.isRecovering', async () => {
      vi.useFakeTimers()
      const source = createMockSource()
      const sm = createMockStateMachine({ isRecovering: true })
      const promise = manager.waitForCondition(source, sm, makeConfig())
      await vi.advanceTimersByTimeAsync(10)
      expect(await promise).toBe('transformed')
    })

    it('cancel() stops polling', async () => {
      vi.useFakeTimers()
      const source = createMockSource(ActionState.ATK_PHY)
      const sm = createMockStateMachine()
      const promise = manager.waitForCondition(source, sm, makeConfig({ absoluteMaxTimeout: 5000 }))

      manager.cancel()
      await vi.advanceTimersByTimeAsync(10000)

      let resolved = false
      promise.then(() => {
        resolved = true
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(resolved).toBe(false)
    })

    it('earlyTerminateChecks fire during phase 1', async () => {
      vi.useFakeTimers()
      const source = createMockSource()
      const sm = createMockStateMachine()
      const checkFn = vi.fn().mockResolvedValue(true)
      const config = makeConfig({
        earlyTerminateChecks: [{ label: 'test-check', check: checkFn, action: 'transformed' }],
      })
      const promise = manager.waitForCondition(source, sm, config)
      await vi.advanceTimersByTimeAsync(10)
      expect(checkFn).toHaveBeenCalled()
      expect(await promise).toBe('transformed')
    })

    it('waits through all 3 phases before timing out', async () => {
      vi.useFakeTimers()
      const source = createMockSource(ActionState.ATK_PHY)
      const sm = createMockStateMachine()
      const config = makeConfig({
        baseTimeout: 100,
        extendedTimeout: 200,
        absoluteMaxTimeout: 300,
        pollInterval: 10,
      })
      const promise = manager.waitForCondition(source, sm, config)

      await vi.advanceTimersByTimeAsync(50)

      await vi.advanceTimersByTimeAsync(150)

      await vi.advanceTimersByTimeAsync(200)
      expect(await promise).toBe('timeout')
    })
  })

  describe('configForCategory', () => {
    it('returns baseTimeout=20000 for Climax', () => {
      const config = AnimationTimeoutManager.configForCategory(Category.Climax, false)
      expect(config.baseTimeout).toBe(20000)
    })

    it('returns baseTimeout=5000 for non-Climax', () => {
      const config = AnimationTimeoutManager.configForCategory(Category.Physical, false)
      expect(config.baseTimeout).toBe(5000)
    })

    it('caps baseTimeout to 3000 when hasTransform=true', () => {
      const config = AnimationTimeoutManager.configForCategory(Category.Climax, true)
      expect(config.baseTimeout).toBe(3000)
    })
  })
})
