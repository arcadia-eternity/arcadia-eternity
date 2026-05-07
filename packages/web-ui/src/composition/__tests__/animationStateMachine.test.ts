/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AnimationStateMachine, AnimationState } from '../animationStateMachine'

describe('AnimationStateMachine', () => {
  let sm: AnimationStateMachine

  beforeEach(() => {
    sm = new AnimationStateMachine()
  })

  describe('initial state', () => {
    it('starts in IDLE state', () => {
      expect(sm.state).toBe(AnimationState.IDLE)
    })
  })

  describe('happy-path transitions', () => {
    it('transition IDLE → PREPARING (valid)', () => {
      sm.transition(AnimationState.PREPARING, 'test')
      expect(sm.state).toBe(AnimationState.PREPARING)
    })

    it('transition PREPARING → PLAYING (valid)', () => {
      sm.transition(AnimationState.PREPARING, 'test')
      sm.transition(AnimationState.PLAYING, 'test')
      expect(sm.state).toBe(AnimationState.PLAYING)
    })

    it('transition PLAYING → COMPLETING (valid)', () => {
      sm.transition(AnimationState.PREPARING, 'test')
      sm.transition(AnimationState.PLAYING, 'test')
      sm.transition(AnimationState.COMPLETING, 'test')
      expect(sm.state).toBe(AnimationState.COMPLETING)
    })

    it('transition COMPLETING → IDLE (valid)', () => {
      sm.transition(AnimationState.PREPARING, 'test')
      sm.transition(AnimationState.PLAYING, 'test')
      sm.transition(AnimationState.COMPLETING, 'test')
      sm.transition(AnimationState.IDLE, 'test')
      expect(sm.state).toBe(AnimationState.IDLE)
    })
  })

  describe('idempotent transition', () => {
    it('transition is idempotent (same state → no-op)', () => {
      const logLength = sm.transitionLog.length
      sm.transition(AnimationState.IDLE, 'test')
      expect(sm.state).toBe(AnimationState.IDLE)
      expect(sm.transitionLog.length).toBe(logLength)
    })
  })

  describe('shouldSkipAnimation', () => {
    it('returns true for CATCHING_UP', () => {
      sm.transition(AnimationState.CATCHING_UP, 'test')
      expect(sm.shouldSkipAnimation).toBe(true)
    })

    it('returns true for RECOVERING', () => {
      sm.transition(AnimationState.RECOVERING, 'test')
      expect(sm.shouldSkipAnimation).toBe(true)
    })

    it('returns false for IDLE', () => {
      expect(sm.shouldSkipAnimation).toBe(false)
    })
  })

  describe('canAcceptNewTask', () => {
    it('returns true only in IDLE', () => {
      expect(sm.canAcceptNewTask).toBe(true)
      sm.transition(AnimationState.PREPARING, 'test')
      expect(sm.canAcceptNewTask).toBe(false)
    })

    it('returns false for non-IDLE states', () => {
      for (const state of [
        AnimationState.PREPARING,
        AnimationState.PLAYING,
        AnimationState.COMPLETING,
        AnimationState.PAUSED,
        AnimationState.CATCHING_UP,
        AnimationState.RECOVERING,
        AnimationState.STUCK,
      ]) {
        sm.reset()
        sm.transition(state, 'test')
        expect(sm.canAcceptNewTask).toBe(false)
      }
    })
  })

  describe('isAnimating', () => {
    it('returns true for PREPARING/PLAYING/COMPLETING', () => {
      for (const state of [AnimationState.PREPARING, AnimationState.PLAYING, AnimationState.COMPLETING]) {
        sm.reset()
        sm.transition(state, 'test')
        expect(sm.isAnimating).toBe(true)
      }
    })

    it('returns false for IDLE', () => {
      expect(sm.isAnimating).toBe(false)
    })
  })

  describe('isRecovering', () => {
    it('returns true for PAUSED/RECOVERING/CATCHING_UP/STUCK', () => {
      for (const state of [
        AnimationState.PAUSED,
        AnimationState.RECOVERING,
        AnimationState.CATCHING_UP,
        AnimationState.STUCK,
      ]) {
        sm.reset()
        sm.transition(state, 'test')
        expect(sm.isRecovering).toBe(true)
      }
    })

    it('returns false for IDLE', () => {
      expect(sm.isRecovering).toBe(false)
    })
  })

  describe('disconnect / reconnect / recovery', () => {
    it('onDisconnect transitions to PAUSED', () => {
      sm.onDisconnect()
      expect(sm.state).toBe(AnimationState.PAUSED)
    })

    it('onReconnect transitions to RECOVERING', () => {
      sm.onDisconnect()
      sm.onReconnect()
      expect(sm.state).toBe(AnimationState.RECOVERING)
    })

    it('onRecoveryComplete transitions to IDLE', () => {
      sm.onDisconnect()
      sm.onReconnect()
      sm.onRecoveryComplete()
      expect(sm.state).toBe(AnimationState.IDLE)
    })
  })

  describe('onBacklog', () => {
    it('transitions to CATCHING_UP from PLAYING with backlog > 0', () => {
      sm.transition(AnimationState.PREPARING, 'test')
      sm.transition(AnimationState.PLAYING, 'test')
      sm.onBacklog(5)
      expect(sm.state).toBe(AnimationState.CATCHING_UP)
    })

    it('does not transition from IDLE', () => {
      sm.onBacklog(5)
      expect(sm.state).toBe(AnimationState.IDLE)
    })

    it('transitions from PREPARING', () => {
      sm.transition(AnimationState.PREPARING, 'test')
      sm.onBacklog(3)
      expect(sm.state).toBe(AnimationState.CATCHING_UP)
    })

    it('transitions from RECOVERING', () => {
      sm.transition(AnimationState.RECOVERING, 'test')
      sm.onBacklog(2)
      expect(sm.state).toBe(AnimationState.CATCHING_UP)
    })
  })

  describe('markStuck', () => {
    it('transitions to STUCK', () => {
      sm.markStuck('timeout')
      expect(sm.state).toBe(AnimationState.STUCK)
    })
  })

  describe('forceRecover', () => {
    it('transitions RECOVERING → IDLE', () => {
      sm.transition(AnimationState.RECOVERING, 'test')
      sm.forceRecover()
      expect(sm.state).toBe(AnimationState.IDLE)
    })

    it('works from any state (forces through RECOVERING)', () => {
      sm.transition(AnimationState.STUCK, 'test')
      sm.forceRecover()
      expect(sm.state).toBe(AnimationState.IDLE)
    })
  })

  describe('beginTask', () => {
    it('resets context fields (hasTransform=false, activeTweenIds=[], tempDomCount=0)', () => {
      sm.beginTask({
        messageType: 'SKILL_USE' as any,
        side: 'left',
        skillId: 'skill-1',
        petId: 'pet-1',
        sequenceId: 1,
        expectedDuration: 500,
      })
      const ctx = sm.context
      expect(ctx.hasTransform).toBe(false)
      expect(ctx.activeTweenIds).toEqual([])
      expect(ctx.tempDomCount).toBe(0)
    })

    it('sets isSpriteAnimation for SKILL_USE', () => {
      sm.beginTask({
        messageType: 'SKILL_USE' as any,
        side: 'right',
        sequenceId: 2,
        expectedDuration: 300,
      })
      expect(sm.context.isSpriteAnimation).toBe(true)
    })

    it('sets isSpriteAnimation=false for non-SKILL_USE', () => {
      sm.beginTask({
        messageType: 'OTHER' as any,
        side: 'left',
        sequenceId: 3,
        expectedDuration: 200,
      })
      expect(sm.context.isSpriteAnimation).toBe(false)
    })
  })

  describe('markTransform', () => {
    it('sets hasTransform=true and currentPetId', () => {
      sm.markTransform('pet-42')
      expect(sm.context.hasTransform).toBe(true)
      expect(sm.context.currentPetId).toBe('pet-42')
    })
  })

  describe('snapshot', () => {
    it('returns deep copy of current context', () => {
      sm.beginTask({
        messageType: 'SKILL_USE' as any,
        side: 'left',
        skillId: 's1',
        petId: 'p1',
        sequenceId: 10,
        expectedDuration: 1000,
      })
      const snap = sm.snapshot()
      expect(snap.state).toBe(AnimationState.IDLE)
      expect(snap.currentMessageType).toBe('SKILL_USE')
      expect(snap.currentSide).toBe('left')
      expect(snap.currentSkillId).toBe('s1')
      expect(snap.currentPetId).toBe('p1')
      expect(snap.sequenceId).toBe(10)

      snap.activeTweenIds.push('extra')
      expect(sm.context.activeTweenIds).toEqual([])
    })
  })

  describe('onStateChange listeners', () => {
    it('listeners fire on transition', () => {
      const fn = vi.fn()
      sm.onStateChange(fn)

      sm.transition(AnimationState.PREPARING, 'test')
      expect(fn).toHaveBeenCalledTimes(1)
      expect(fn).toHaveBeenCalledWith(
        AnimationState.IDLE,
        AnimationState.PREPARING,
        expect.objectContaining({ state: AnimationState.PREPARING }),
      )
    })

    it('unsub works', () => {
      const fn = vi.fn()
      const unsub = sm.onStateChange(fn)

      sm.transition(AnimationState.PREPARING, 'test')
      expect(fn).toHaveBeenCalledTimes(1)

      unsub()
      sm.transition(AnimationState.PLAYING, 'test')
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('multiple listeners all fire', () => {
      const fn1 = vi.fn()
      const fn2 = vi.fn()
      sm.onStateChange(fn1)
      sm.onStateChange(fn2)

      sm.transition(AnimationState.PLAYING, 'test')
      expect(fn1).toHaveBeenCalledTimes(1)
      expect(fn2).toHaveBeenCalledTimes(1)
    })
  })

  describe('transition log', () => {
    it('logs transitions', () => {
      sm.transition(AnimationState.PREPARING, 'step1')
      sm.transition(AnimationState.PLAYING, 'step2')

      const log = sm.transitionLog
      expect(log.length).toBe(2)
      expect(log[0]).toEqual({
        from: AnimationState.IDLE,
        to: AnimationState.PREPARING,
        time: expect.any(Number),
        reason: 'step1',
      })
      expect(log[1]).toEqual({
        from: AnimationState.PREPARING,
        to: AnimationState.PLAYING,
        time: expect.any(Number),
        reason: 'step2',
      })
    })

    it('getRecentTransitions returns last N entries', () => {
      sm.transition(AnimationState.PREPARING, 'a')
      sm.transition(AnimationState.PLAYING, 'b')
      sm.transition(AnimationState.COMPLETING, 'c')

      expect(sm.getRecentTransitions(2)).toHaveLength(2)
      expect(sm.getRecentTransitions(2)[0].reason).toBe('b')
    })
  })

  describe('reset and destroy', () => {
    it('reset returns to IDLE with clean context', () => {
      sm.transition(AnimationState.STUCK, 'test')
      sm.reset()
      expect(sm.state).toBe(AnimationState.IDLE)
      expect(sm.context.hasTransform).toBe(false)
      expect(sm.context.activeTweenIds).toEqual([])
      expect(sm.context.tempDomCount).toBe(0)
    })

    it('destroy clears listeners and log', () => {
      const fn = vi.fn()
      sm.onStateChange(fn)
      sm.transition(AnimationState.STUCK, 'test')

      sm.destroy()
      expect(sm.transitionLog.length).toBe(0)
      expect(sm.state).toBe(AnimationState.IDLE)

      sm.transition(AnimationState.PREPARING, 'after-destroy')
      expect(fn).toHaveBeenCalledTimes(1)
    })
  })
})
