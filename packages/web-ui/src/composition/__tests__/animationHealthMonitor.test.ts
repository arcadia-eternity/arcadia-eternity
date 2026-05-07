/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AnimationHealthMonitor } from '../animationHealthMonitor'
import { AnimationState } from '../animationStateMachine'
import type { AnimationStateMachine } from '../animationStateMachine'
import type { AnimationGsapManager } from '../animationGsapManager'
import type { BattleStoreLike } from '../animationTypes'

function createStoreMock(): BattleStoreLike {
  return {
    isReplayMode: false,
    isBattleEnd: false,
    battleState: { status: 'Active', currentPhase: 'SELECTION_PHASE' },
    availableActions: [],
    waitingForResponse: false,
    fetchAvailableSelection: vi.fn().mockResolvedValue([]),
    playerId: 'player-1',
    lastProcessedSequenceId: 0,
    animateQueue: { complete: vi.fn() },
    battleInterface: null,
  }
}

function createGsapManagerMock(): AnimationGsapManager {
  return {
    isAnyActive: vi.fn().mockReturnValue(false),
    killAll: vi.fn(),
  } as unknown as AnimationGsapManager
}

function createStateMachineMock(): AnimationStateMachine {
  return {
    state: AnimationState.IDLE,
    snapshot: vi.fn().mockReturnValue({
      state: AnimationState.IDLE,
      startTime: 0,
      expectedDuration: 10000,
      isSpriteAnimation: false,
    }),
    transition: vi.fn(),
    markStuck: vi.fn(),
    forceRecover: vi.fn(),
  } as unknown as AnimationStateMachine
}

describe('AnimationHealthMonitor', () => {
  let stateMachine: AnimationStateMachine
  let store: BattleStoreLike
  let gsapManager: AnimationGsapManager
  let monitor: AnimationHealthMonitor

  beforeEach(() => {
    vi.useFakeTimers()
    stateMachine = createStateMachineMock()
    store = createStoreMock()
    gsapManager = createGsapManagerMock()
    monitor = new AnimationHealthMonitor(stateMachine, store, gsapManager)
  })

  afterEach(() => {
    monitor.stop()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('start sets up periodic interval with 3000ms', () => {
    const spy = vi.spyOn(globalThis, 'setInterval')
    monitor.start()
    expect(spy).toHaveBeenCalledWith(expect.any(Function), 3000)
  })

  it('stop clears interval', () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
    monitor.start()
    monitor.stop()
    expect(clearIntervalSpy).toHaveBeenCalled()
  })

  it('does nothing when state machine is IDLE', async () => {
    ;(stateMachine as any).state = AnimationState.IDLE
    ;(stateMachine.snapshot as ReturnType<typeof vi.fn>).mockReturnValue({
      state: AnimationState.IDLE,
      startTime: 0,
      expectedDuration: 10000,
      isSpriteAnimation: false,
    })
    store.availableActions = [{ type: 'test' }]

    monitor.start()
    await vi.advanceTimersByTimeAsync(3000)

    expect(stateMachine.forceRecover).not.toHaveBeenCalled()
    expect(gsapManager.killAll).not.toHaveBeenCalled()
  })

  it('forces recovery when elapsed > maxDuration in PLAYING', async () => {
    ;(stateMachine as any).state = AnimationState.PLAYING
    const startTime = performance.now()
    ;(stateMachine.snapshot as ReturnType<typeof vi.fn>).mockReturnValue({
      state: AnimationState.PLAYING,
      startTime,
      expectedDuration: 5000,
      isSpriteAnimation: false,
    })
    store.availableActions = [{ type: 'test' }]

    monitor.start()
    await vi.advanceTimersByTimeAsync(33000)

    expect(gsapManager.killAll).toHaveBeenCalled()
    expect(stateMachine.forceRecover).toHaveBeenCalled()
  })

  it('forces recovery when all GSAP tweens dead near timeout', async () => {
    ;(stateMachine as any).state = AnimationState.PLAYING
    const startTime = performance.now()
    ;(stateMachine.snapshot as ReturnType<typeof vi.fn>).mockReturnValue({
      state: AnimationState.PLAYING,
      startTime,
      expectedDuration: 5000,
      isSpriteAnimation: false,
    })
    ;(gsapManager.isAnyActive as ReturnType<typeof vi.fn>).mockReturnValue(false)
    store.availableActions = [{ type: 'test' }]

    monitor.start()
    await vi.advanceTimersByTimeAsync(27000)

    expect(gsapManager.killAll).toHaveBeenCalled()
    expect(stateMachine.forceRecover).toHaveBeenCalled()
  })

  it('does NOT force recovery for sprite animations near timeout', async () => {
    ;(stateMachine as any).state = AnimationState.PLAYING
    const startTime = performance.now()
    ;(stateMachine.snapshot as ReturnType<typeof vi.fn>).mockReturnValue({
      state: AnimationState.PLAYING,
      startTime,
      expectedDuration: 5000,
      isSpriteAnimation: true,
    })
    ;(gsapManager.isAnyActive as ReturnType<typeof vi.fn>).mockReturnValue(false)
    store.availableActions = [{ type: 'test' }]

    monitor.start()
    await vi.advanceTimersByTimeAsync(27000)

    expect(gsapManager.killAll).not.toHaveBeenCalled()
    expect(stateMachine.forceRecover).not.toHaveBeenCalled()
  })

  it('increments stuckCount when availableActions empty and not waiting', async () => {
    ;(stateMachine as any).state = AnimationState.IDLE
    store.availableActions = []
    store.waitingForResponse = false

    monitor.start()
    await vi.advanceTimersByTimeAsync(3000)

    expect(store.fetchAvailableSelection).not.toHaveBeenCalled()
  })

  it('attempts fetchAvailableSelection when stuckCount >= 2', async () => {
    ;(stateMachine as any).state = AnimationState.IDLE
    store.availableActions = []
    store.waitingForResponse = false

    monitor.start()
    await vi.advanceTimersByTimeAsync(3000)
    await vi.advanceTimersByTimeAsync(3000)

    expect(store.fetchAvailableSelection).toHaveBeenCalled()
  })

  it('marks STUCK when stuckCount >= MAX_STUCK_COUNT (3)', async () => {
    ;(stateMachine as any).state = AnimationState.IDLE
    store.availableActions = []
    store.waitingForResponse = false
    ;(store.fetchAvailableSelection as ReturnType<typeof vi.fn>).mockResolvedValue([])

    monitor.start()
    await vi.advanceTimersByTimeAsync(3000)
    await vi.advanceTimersByTimeAsync(3000)
    await vi.advanceTimersByTimeAsync(3000)

    expect(stateMachine.markStuck).toHaveBeenCalledWith('no-available-actions')
  })

  it('skips availableActions check in replay mode', async () => {
    store.isReplayMode = true
    store.availableActions = []

    monitor.start()
    await vi.advanceTimersByTimeAsync(3000)
    await vi.advanceTimersByTimeAsync(3000)

    expect(store.fetchAvailableSelection).not.toHaveBeenCalled()
  })

  it('skips when battleEnded', async () => {
    store.isBattleEnd = true
    store.availableActions = []

    monitor.start()
    await vi.advanceTimersByTimeAsync(3000)
    await vi.advanceTimersByTimeAsync(3000)

    expect(store.fetchAvailableSelection).not.toHaveBeenCalled()
  })

  it('resets stuckCount when actions become available again', async () => {
    ;(stateMachine as any).state = AnimationState.IDLE
    store.availableActions = []
    store.waitingForResponse = false

    monitor.start()
    await vi.advanceTimersByTimeAsync(3000)

    store.availableActions = [{ type: 'test' }]
    await vi.advanceTimersByTimeAsync(3000)

    store.availableActions = []
    await vi.advanceTimersByTimeAsync(3000)

    expect(store.fetchAvailableSelection).not.toHaveBeenCalled()
  })
})
