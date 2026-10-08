import { afterEach, describe, expect, it, vi } from 'vitest'
import { Subject } from 'rxjs'
import { BattleMessageType } from '@arcadia-eternity/const'
import { AnimationController } from '../animationController'
import { AnimationState, AnimationStateMachine } from '../animationStateMachine'
import { AnimationTimeoutManager, type TimeoutConfig } from '../animationTimeout'
import { AnimationGsapManager } from '../animationGsapManager'
import type { BattleStoreLike } from '../animationTypes'

function storeMock(): BattleStoreLike {
  return {
    isReplayMode: false,
    isBattleEnd: false,
    battleState: { status: 'Active', currentPhase: 'SELECTION_PHASE' },
    availableActions: [],
    waitingForResponse: false,
    fetchAvailableSelection: vi.fn(async () => []),
    playerId: 'player-1',
    lastProcessedSequenceId: 10,
    animateQueue: new Subject(),
    battleInterface: null,
  }
}
const task = (sequenceId: number) => ({
  messageType: BattleMessageType.SkillUse,
  side: 'left' as const,
  sequenceId,
  expectedDuration: 5000,
})
const controllers: AnimationController[] = []
function controller() {
  const store = storeMock()
  const ctrl = new AnimationController(store)
  controllers.push(ctrl)
  return { ctrl, store }
}
afterEach(() => {
  controllers.splice(0).forEach(ctrl => ctrl.destroy())
  vi.useRealTimers()
})

describe('animation completeness: safety and liveness obligations', () => {
  it('S1: a late playing callback must preserve a disconnected state', () => {
    const { ctrl } = controller()
    const first = ctrl.beginAnimation(task(1))
    ctrl.onDisconnect()
    ctrl.onAnimationPlaying(first)
    expect(ctrl.stateMachine.state).toBe(AnimationState.PAUSED)
  })

  it('S2: beginning a task while another is playing must preserve its context', () => {
    const { ctrl } = controller()
    const first = ctrl.beginAnimation(task(1))
    ctrl.onAnimationPlaying(first)
    ctrl.beginAnimation(task(2))
    expect(ctrl.stateMachine.snapshot().sequenceId).toBe(1)
    expect(ctrl.stateMachine.state).toBe(AnimationState.PLAYING)
  })

  it('S3: completion from the previous task must not finish a newer task', () => {
    const { ctrl } = controller()
    const first = ctrl.beginAnimation(task(1))
    const oldCompletion = () => {
      ctrl.onAnimationComplete(first)
      ctrl.onAnimationCleanupDone(first)
    }
    ctrl.healthMonitor.forceRecovery()
    const second = ctrl.beginAnimation(task(2))
    ctrl.onAnimationPlaying(second)
    oldCompletion()
    expect(ctrl.stateMachine.state).toBe(AnimationState.PLAYING)
    expect(ctrl.stateMachine.snapshot().sequenceId).toBe(2)
  })

  it('S4: a reconnect response must not resurrect a connection that disconnected again', async () => {
    const { ctrl, store } = controller()
    let finish!: (value: { status: string; sequenceId?: number }) => void
    store.battleInterface = {
      getState: () =>
        new Promise(resolve => {
          finish = resolve
        }),
    }
    ctrl.beginAnimation(task(10))
    ctrl.onDisconnect()
    const reconnect = ctrl.onReconnect(store)
    ctrl.onDisconnect()
    finish({ status: 'Active', sequenceId: 11 })
    await reconnect
    expect(ctrl.stateMachine.state).toBe(AnimationState.PAUSED)
    expect(store.lastProcessedSequenceId).toBe(10)
  })

  it('L1: cancellation must settle the outstanding wait', async () => {
    vi.useFakeTimers()
    const manager = new AnimationTimeoutManager()
    const sm = new AnimationStateMachine()
    let settled = false
    void manager
      .waitForCondition(null, sm, {
        baseTimeout: 100,
        extendedTimeout: 150,
        absoluteMaxTimeout: 300,
        pollInterval: 10,
        earlyTerminateChecks: [],
      })
      .then(() => {
        settled = true
      })
    manager.cancel()
    await vi.advanceTimersByTimeAsync(1000)
    expect(settled).toBe(true)
  })

  it('L2: a hung renderer RPC must not defeat the absolute deadline', async () => {
    vi.useFakeTimers()
    const manager = new AnimationTimeoutManager()
    const sm = new AnimationStateMachine()
    const config: TimeoutConfig = {
      baseTimeout: 10,
      extendedTimeout: 20,
      absoluteMaxTimeout: 100,
      pollInterval: 10,
      earlyTerminateChecks: [],
    }
    let result: string | undefined
    void manager.waitForCondition({ getState: () => new Promise(() => {}) }, sm, config).then(value => {
      result = value
    })
    await vi.advanceTimersByTimeAsync(1000)
    manager.cancel()
    expect(result).toBe('timeout')
  })

  it('L3: reconnect must preserve the queue captured by the page producer and consumer', async () => {
    const { ctrl, store } = controller()
    const queue = store.animateQueue as Subject<() => Promise<void>>
    const consumed = vi.fn()
    const subscription = queue.subscribe(consumed)
    ctrl.onDisconnect()
    await ctrl.onReconnect(store)
    queue.next(async () => {})
    subscription.unsubscribe()
    expect(consumed).toHaveBeenCalledOnce()
  })

  it('L4: interrupting managed GSAP playback awaited by the page must settle', async () => {
    vi.useFakeTimers()
    const manager = new AnimationGsapManager()
    const playback = manager.createTweenPlayback({ x: 0 }, { x: 100, duration: 1, id: 'switch-pet' })
    let settled = false
    void playback.finished.then(() => {
      settled = true
    })
    manager.killAll()
    await vi.advanceTimersByTimeAsync(10000)
    expect(settled).toBe(true)
  })

  it('S5: callbacks after destroy must not recreate active animation state', () => {
    const { ctrl } = controller()
    const first = ctrl.beginAnimation(task(1))
    ctrl.destroy()
    ctrl.onAnimationPlaying(first)
    ctrl.onAnimationComplete(first)
    ctrl.onAnimationCleanupDone(first)
    expect(ctrl.stateMachine.isAnimating).toBe(false)
    expect(ctrl.isTaskCurrent(first)).toBe(false)
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(finish => {
    resolve = finish
  })
  return { promise, resolve }
}
describe('recovery race regressions', () => {
  it('new reconnect wins when two snapshot replies arrive in reverse order', async () => {
    const { ctrl, store } = controller()
    const old = deferred<{ status: string; sequenceId: number }>()
    const fresh = deferred<{ status: string; sequenceId: number }>()
    store.battleInterface = { getState: vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise) }
    const first = ctrl.onReconnect(store)
    const second = ctrl.onReconnect(store)
    fresh.resolve({ status: 'Active', sequenceId: 30 })
    expect(await second).toBe(true)
    old.resolve({ status: 'Active', sequenceId: 20 })
    expect(await first).toBe(false)
    expect(store.lastProcessedSequenceId).toBe(30)
    expect(ctrl.stateMachine.state).toBe(AnimationState.IDLE)
  })
  it('disconnect while fetching actions commits neither snapshot nor actions', async () => {
    const { ctrl, store } = controller()
    const actions = deferred<unknown[]>()
    store.battleInterface = { getState: async () => ({ status: 'Active', sequenceId: 30 }) }
    store.fetchAvailableSelection = vi.fn(() => actions.promise)
    const originalState = store.battleState
    const reconnect = ctrl.onReconnect(store)
    await vi.waitFor(() => expect(store.fetchAvailableSelection).toHaveBeenCalledOnce())
    ctrl.onDisconnect()
    expect(await reconnect).toBe(false)
    actions.resolve(['obsolete'])
    await Promise.resolve()
    expect(store.battleState).toBe(originalState)
    expect(store.availableActions).toEqual([])
    expect(ctrl.stateMachine.state).toBe(AnimationState.PAUSED)
  })
  it('hung snapshot has a hard deadline and can retry successfully', async () => {
    vi.useFakeTimers()
    const { ctrl, store } = controller()
    const old = deferred<{ status: string; sequenceId: number }>()
    store.battleInterface = {
      getState: vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue({ status: 'Active', sequenceId: 40 }),
    }
    const reconnect = ctrl.onReconnect(store)
    await vi.advanceTimersByTimeAsync(10000)
    expect(await reconnect).toBe(false)
    expect(ctrl.stateMachine.state).toBe(AnimationState.STUCK)
    expect(await ctrl.onReconnect(store)).toBe(true)
    old.resolve({ status: 'Active', sequenceId: 15 })
    await Promise.resolve()
    expect(store.lastProcessedSequenceId).toBe(40)
  })
  it('destroy cancels a pending snapshot without waiting for its reply', async () => {
    const { ctrl, store } = controller()
    const old = deferred<{ status: string; sequenceId: number }>()
    store.battleInterface = { getState: () => old.promise }
    const reconnect = ctrl.onReconnect(store)
    ctrl.destroy()
    expect(await reconnect).toBe(false)
    old.resolve({ status: 'Active', sequenceId: 50 })
    await Promise.resolve()
    expect(store.lastProcessedSequenceId).toBe(10)
    expect(ctrl.beginAnimation(task(11))).toBeNull()
  })
  it('a cancelled renderer poll cannot finish the next wait', async () => {
    vi.useFakeTimers()
    const manager = new AnimationTimeoutManager()
    const old = deferred<import('seer2-pet-animator').ActionState>()
    const config = {
      baseTimeout: 0,
      extendedTimeout: 100,
      absoluteMaxTimeout: 200,
      pollInterval: 10,
      earlyTerminateChecks: [],
    }
    const first = manager.waitForCondition({ getState: () => old.promise }, new AnimationStateMachine(), config)
    await vi.advanceTimersByTimeAsync(10)
    const second = manager.waitForCondition(
      { getState: () => new Promise(() => {}) },
      new AnimationStateMachine(),
      config,
    )
    expect(await first).toBe('cancelled')
    old.resolve('待机' as import('seer2-pet-animator').ActionState)
    await vi.advanceTimersByTimeAsync(200)
    expect(await second).toBe('timeout')
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('queue suspension protocol', () => {
  it('a task arriving during snapshot synchronization waits and survives on the captured channel', async () => {
    const { ctrl, store } = controller()
    const snapshot = deferred<{ status: string; sequenceId: number }>()
    store.battleInterface = { getState: () => snapshot.promise }
    const reconnect = ctrl.onReconnect(store)
    const ready = ctrl.waitUntilReady()
    let released = false
    void ready.then(() => {
      released = true
    })
    await Promise.resolve()
    expect(released).toBe(false)
    snapshot.resolve({ status: 'Active', sequenceId: 20 })
    await reconnect
    expect(await ready).toBe(true)
    expect(ctrl.beginAnimation(task(21))).not.toBeNull()
  })
  it('destroy releases a queue waiting for connection recovery', async () => {
    const { ctrl } = controller()
    ctrl.onDisconnect()
    const ready = ctrl.waitUntilReady()
    ctrl.destroy()
    expect(await ready).toBe(false)
  })
})

it('a token from another controller with the same numeric ID has no authority', () => {
  const { ctrl: first } = controller()
  const { ctrl: second } = controller()
  const foreign = first.beginAnimation(task(1))!
  const own = second.beginAnimation(task(2))!
  expect(foreign.id).toBe(own.id)
  second.onAnimationPlaying(foreign)
  expect(second.stateMachine.state).toBe(AnimationState.PREPARING)
  expect(second.isTaskCurrent(own)).toBe(true)
})
