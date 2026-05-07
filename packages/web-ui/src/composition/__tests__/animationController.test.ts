/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AnimationController } from '../animationController'
import { AnimationState } from '../animationStateMachine'
import type { BattleStoreLike } from '../animationTypes'

function createMockStore(overrides?: Partial<BattleStoreLike>): BattleStoreLike {
  return {
    isReplayMode: false,
    isBattleEnd: false,
    battleState: null,
    availableActions: [],
    waitingForResponse: false,
    fetchAvailableSelection: vi.fn().mockResolvedValue([]),
    playerId: 'player-1',
    lastProcessedSequenceId: 0,
    animateQueue: { complete: vi.fn() } as any,
    battleInterface: {
      getState: vi.fn().mockResolvedValue({ status: 'battle', sequenceId: 10 }),
    },
    ...overrides,
  }
}

describe('AnimationController', () => {
  let store: BattleStoreLike
  let ctrl: AnimationController

  beforeEach(() => {
    store = createMockStore()
    ctrl = new AnimationController(store)
  })

  describe('constructor', () => {
    it('creates all sub-modules and attaches gsapManager to stateMachine', () => {
      expect(ctrl.stateMachine).toBeDefined()
      expect(ctrl.timeoutManager).toBeDefined()
      expect(ctrl.gsapManager).toBeDefined()
      expect(ctrl.healthMonitor).toBeDefined()

      const attachSpy = vi.spyOn(ctrl.gsapManager.constructor.prototype, 'attach')
      const newCtrl = new AnimationController(store)
      expect(attachSpy).toHaveBeenCalledWith(newCtrl.stateMachine)
      attachSpy.mockRestore()
    })
  })

  describe('start', () => {
    it('starts healthMonitor', () => {
      const spy = vi.spyOn(ctrl.healthMonitor, 'start')
      ctrl.start()
      expect(spy).toHaveBeenCalled()
    })
  })

  describe('destroy', () => {
    it('cleans up all modules', () => {
      const healthStop = vi.spyOn(ctrl.healthMonitor, 'stop')
      const timeoutCancel = vi.spyOn(ctrl.timeoutManager, 'cancel')
      const gsapKill = vi.spyOn(ctrl.gsapManager, 'killAll')
      const smDestroy = vi.spyOn(ctrl.stateMachine, 'destroy')

      ctrl.destroy()

      expect(healthStop).toHaveBeenCalled()
      expect(timeoutCancel).toHaveBeenCalled()
      expect(gsapKill).toHaveBeenCalled()
      expect(smDestroy).toHaveBeenCalled()
    })
  })

  describe('beginAnimation', () => {
    it('transitions state machine to PREPARING', () => {
      ctrl.beginAnimation({
        messageType: 'SKILL_USE' as any,
        side: 'left',
        skillId: 'skill-1',
        petId: 'pet-1',
        sequenceId: 1,
        expectedDuration: 500,
      })
      expect(ctrl.stateMachine.state).toBe(AnimationState.PREPARING)
    })
  })

  describe('onAnimationPlaying', () => {
    it('transitions to PLAYING', () => {
      ctrl.beginAnimation({
        messageType: 'SKILL_USE' as any,
        side: 'left',
        sequenceId: 1,
        expectedDuration: 500,
      })
      ctrl.onAnimationPlaying()
      expect(ctrl.stateMachine.state).toBe(AnimationState.PLAYING)
    })
  })

  describe('onAnimationComplete', () => {
    it('transitions to COMPLETING', () => {
      ctrl.beginAnimation({
        messageType: 'SKILL_USE' as any,
        side: 'left',
        sequenceId: 1,
        expectedDuration: 500,
      })
      ctrl.onAnimationPlaying()
      ctrl.onAnimationComplete()
      expect(ctrl.stateMachine.state).toBe(AnimationState.COMPLETING)
    })
  })

  describe('onAnimationCleanupDone', () => {
    it('transitions COMPLETING → IDLE', () => {
      ctrl.beginAnimation({
        messageType: 'SKILL_USE' as any,
        side: 'left',
        sequenceId: 1,
        expectedDuration: 500,
      })
      ctrl.onAnimationPlaying()
      ctrl.onAnimationComplete()
      ctrl.onAnimationCleanupDone()
      expect(ctrl.stateMachine.state).toBe(AnimationState.IDLE)
    })

    it('does nothing from IDLE (no transition)', () => {
      const logLen = ctrl.stateMachine.transitionLog.length
      ctrl.onAnimationCleanupDone()
      expect(ctrl.stateMachine.state).toBe(AnimationState.IDLE)
      expect(ctrl.stateMachine.transitionLog.length).toBe(logLen)
    })
  })

  describe('waitForHit', () => {
    it('delegates to timeoutManager with reduced baseTimeout (base/3)', async () => {
      vi.useFakeTimers()
      const spy = vi.spyOn(ctrl.timeoutManager, 'waitForCondition').mockResolvedValue('completed')

      const result = ctrl.waitForHit(null, 'normal' as any)
      expect(spy).toHaveBeenCalled()

      const config = spy.mock.calls[0][2]
      const fullConfig = (ctrl.timeoutManager.constructor as any).configForCategory('normal', false)
      expect(config.baseTimeout).toBe(Math.min(fullConfig.baseTimeout / 3, 3000))

      await result
      vi.useRealTimers()
    })
  })

  describe('waitForAnimationComplete', () => {
    it('delegates to timeoutManager with full config', async () => {
      vi.useFakeTimers()
      const spy = vi.spyOn(ctrl.timeoutManager, 'waitForCondition').mockResolvedValue('completed')

      const result = ctrl.waitForAnimationComplete(null, 'normal' as any)
      expect(spy).toHaveBeenCalled()

      const config = spy.mock.calls[0][2]
      const fullConfig = (ctrl.timeoutManager.constructor as any).configForCategory('normal', false)
      expect(config.baseTimeout).toBe(fullConfig.baseTimeout)

      await result
      vi.useRealTimers()
    })
  })

  describe('checkDeltaForTransform', () => {
    it('detects [oldSpeciesID, newSpeciesID] diff array', () => {
      const delta = {
        players: {
          '0': {
            team: {
              '0': {
                id: 'pet-1',
                speciesID: ['oldSpecies', 'newSpecies'],
              },
            },
          },
        },
      }
      const result = ctrl.checkDeltaForTransform(delta as any, 'pet-1')
      expect(result).toBe(true)
    })

    it('returns false for non-transform delta', () => {
      const delta = {
        players: {
          '0': {
            team: {
              '0': {
                id: 'pet-1',
                speciesID: 'sameSpecies',
              },
            },
          },
        },
      }
      vi.spyOn(ctrl as any, 'findPetInState').mockReturnValue('sameSpecies')
      const result = ctrl.checkDeltaForTransform(delta as any, 'pet-1')
      expect(result).toBe(false)
    })
  })

  describe('onDisconnect', () => {
    it('kills all GSAP tweens and cancels timeout', () => {
      const gsapSpy = vi.spyOn(ctrl.gsapManager, 'killAll')
      const timeoutSpy = vi.spyOn(ctrl.timeoutManager, 'cancel')

      ctrl.onDisconnect()

      expect(gsapSpy).toHaveBeenCalled()
      expect(timeoutSpy).toHaveBeenCalled()
    })
  })

  describe('onReconnect', () => {
    it('fetches latest state from server via battleInterface.getState', async () => {
      store.lastProcessedSequenceId = 5
      const getStateMock = vi.fn().mockResolvedValue({ status: 'battle', sequenceId: 10 })
      store.battleInterface = { getState: getStateMock }

      await ctrl.onReconnect(store)

      expect(getStateMock).toHaveBeenCalledWith('player-1', false)
    })

    it('fires registered listeners with ReconnectEvent', async () => {
      const listener = vi.fn()
      ctrl.registerReconnectListener(listener)

      store.lastProcessedSequenceId = 5
      store.battleInterface = {
        getState: vi.fn().mockResolvedValue({ status: 'battle', sequenceId: 10 }),
      }

      await ctrl.onReconnect(store)

      expect(listener).toHaveBeenCalledWith({
        lastSequenceId: expect.any(Number),
        latestSequenceId: 10,
        backlog: expect.any(Number),
      })
    })

    it('triggers CATCHING_UP state when backlog > 5', async () => {
      store.lastProcessedSequenceId = 5
      store.battleInterface = {
        getState: vi.fn().mockResolvedValue({ status: 'battle', sequenceId: 20 }),
      }

      await ctrl.onReconnect(store)

      expect(ctrl.stateMachine.state).toBe(AnimationState.CATCHING_UP)
    })

    it('triggers RECOVERING→IDLE when backlog <= 5', async () => {
      ctrl.beginAnimation({
        messageType: 'SKILL_USE' as any,
        side: 'left',
        sequenceId: 5,
        expectedDuration: 500,
      })
      store.lastProcessedSequenceId = 5
      store.battleInterface = {
        getState: vi.fn().mockResolvedValue({ status: 'battle', sequenceId: 8 }),
      }

      await ctrl.onReconnect(store)

      expect(ctrl.stateMachine.state).toBe(AnimationState.IDLE)
    })

    it('creates new Subject after completing old animateQueue', async () => {
      const oldComplete = vi.fn()
      store.animateQueue = { complete: oldComplete } as any

      store.battleInterface = {
        getState: vi.fn().mockResolvedValue({ status: 'battle', sequenceId: 5 }),
      }

      await ctrl.onReconnect(store)

      expect(oldComplete).toHaveBeenCalled()
      expect((store as any).animateQueue).toBeDefined()
      expect(typeof (store as any).animateQueue.subscribe).toBe('function')
    })
  })

  describe('markBacklogCleared', () => {
    it('calls stateMachine.onCatchupComplete', () => {
      const spy = vi.spyOn(ctrl.stateMachine, 'onCatchupComplete')
      ctrl.markBacklogCleared()
      expect(spy).toHaveBeenCalled()
    })
  })

  describe('registerReconnectListener', () => {
    it('returns unsubscribe function, listener fires then unsub works', async () => {
      const listener = vi.fn()
      const unsub = ctrl.registerReconnectListener(listener)

      store.battleInterface = {
        getState: vi.fn().mockResolvedValue({ status: 'battle', sequenceId: 5 }),
      }

      await ctrl.onReconnect(store)
      expect(listener).toHaveBeenCalledTimes(1)

      unsub()

      await ctrl.onReconnect(store)
      expect(listener).toHaveBeenCalledTimes(1)
    })
  })
})
