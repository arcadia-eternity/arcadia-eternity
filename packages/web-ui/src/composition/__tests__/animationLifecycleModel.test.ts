import { describe, expect, it } from 'vitest'
import { Subject } from 'rxjs'
import { BattleMessageType } from '@arcadia-eternity/const'
import { AnimationController, type AnimationTask } from '../animationController'
import { AnimationState as S } from '../animationStateMachine'
import type { BattleStoreLike } from '../animationTypes'

const events = [
  'begin',
  'play',
  'complete',
  'cleanup',
  'disconnect',
  'recover',
  'recovered',
  'backlog',
  'caughtUp',
  'force',
  'stuck',
  'destroy',
  'stalePlay',
  'staleComplete',
] as const
type Event = (typeof events)[number]
type Model = { phase: S; active: boolean; disposed: boolean; first: 'absent' | 'current' | 'stale'; sequence: number }
const initial = (): Model => ({ phase: S.IDLE, active: false, disposed: false, first: 'absent', sequence: -1 })
// Independent event specification, rather than importing the implementation's edge table.
function next(model: Model, event: Event, sequence: number): Model {
  const m = { ...model }
  if (m.disposed) return m
  const cancel = () => {
    m.active = false
    if (m.first === 'current') m.first = 'stale'
  }
  switch (event) {
    case 'begin':
      if (m.phase === S.IDLE && !m.active) {
        m.active = true
        m.phase = S.PREPARING
        m.sequence = sequence
        if (m.first === 'absent') m.first = 'current'
      }
      break
    case 'stalePlay':
      if (m.first !== 'current') break
    // fall through: a retained first token remains valid only while it owns the current task.
    case 'play':
      if (m.active && m.phase === S.PREPARING) m.phase = S.PLAYING
      break
    case 'staleComplete':
      if (m.first !== 'current') break
    case 'complete':
      if (m.active && [S.PREPARING, S.PLAYING].includes(m.phase)) m.phase = S.COMPLETING
      break
    case 'cleanup':
      if (m.active && m.phase === S.COMPLETING) {
        cancel()
        m.phase = S.IDLE
      }
      break
    case 'disconnect':
      cancel()
      m.phase = S.PAUSED
      break
    case 'recover':
      cancel()
      m.phase = S.RECOVERING
      break
    case 'recovered':
      if (m.phase === S.RECOVERING) m.phase = S.IDLE
      break
    case 'backlog':
      if ([S.PREPARING, S.PLAYING, S.RECOVERING].includes(m.phase)) {
        cancel()
        m.phase = S.CATCHING_UP
      }
      break
    case 'caughtUp':
      if (m.phase === S.CATCHING_UP) m.phase = S.IDLE
      break
    case 'force':
      if (m.phase !== S.PAUSED) {
        cancel()
        m.phase = S.IDLE
      }
      break
    case 'stuck':
      if (m.phase !== S.PAUSED) {
        cancel()
        m.phase = S.STUCK
      }
      break
    case 'destroy':
      cancel()
      m.phase = S.IDLE
      m.sequence = -1
      m.disposed = true
      break
  }
  return m
}
function run(trace: Event[]) {
  const store: BattleStoreLike = {
    isReplayMode: true,
    isBattleEnd: false,
    battleState: null,
    availableActions: [],
    waitingForResponse: false,
    fetchAvailableSelection: async () => [],
    playerId: 'p',
    lastProcessedSequenceId: 0,
    animateQueue: new Subject(),
    battleInterface: null,
  }
  const ctrl = new AnimationController(store)
  let current: AnimationTask | null = null
  let first: AnimationTask | null = null
  let model = initial()
  try {
    trace.forEach((event, index) => {
      model = next(model, event, index)
      switch (event) {
        case 'begin': {
          const task = ctrl.beginAnimation({
            messageType: BattleMessageType.SkillUse,
            side: 'left',
            sequenceId: index,
            expectedDuration: 5000,
          })
          if (task) {
            current = task
            first ??= task
          }
          break
        }
        case 'play':
          ctrl.onAnimationPlaying(current)
          break
        case 'complete':
          ctrl.onAnimationComplete(current)
          break
        case 'cleanup':
          ctrl.onAnimationCleanupDone(current)
          break
        case 'disconnect':
          ctrl.onDisconnect()
          break
        case 'recover':
          ctrl.stateMachine.onReconnect()
          break
        case 'recovered':
          ctrl.stateMachine.onRecoveryComplete()
          break
        case 'backlog':
          ctrl.stateMachine.onBacklog(8)
          break
        case 'caughtUp':
          ctrl.markBacklogCleared()
          break
        case 'force':
          ctrl.healthMonitor.forceRecovery()
          break
        case 'stuck':
          ctrl.stateMachine.markStuck('test')
          break
        case 'destroy':
          ctrl.destroy()
          break
        case 'stalePlay':
          ctrl.onAnimationPlaying(first)
          break
        case 'staleComplete':
          ctrl.onAnimationComplete(first)
          break
      }
      expect(ctrl.stateMachine.state, trace.join(' → ')).toBe(model.phase)
      expect(ctrl.isTaskCurrent(current), trace.join(' → ')).toBe(model.active)
      expect(ctrl.stateMachine.snapshot().sequenceId, trace.join(' → ')).toBe(model.sequence)
      expect(ctrl.stateMachine.canAcceptNewTask).toBe(!model.disposed && model.phase === S.IDLE)
    })
  } finally {
    ctrl.destroy()
  }
  return model
}

describe('finite lifecycle model', () => {
  it('covers every event from every reachable phase / task ownership / terminal combination', () => {
    const pending: Event[][] = [[]]
    const seen = new Set<string>()
    let checked = 0
    for (let cursor = 0; cursor < pending.length; cursor++) {
      const trace = pending[cursor]!
      const model = run(trace)
      const key = JSON.stringify([model.phase, model.active, model.disposed, model.first])
      if (seen.has(key)) continue
      seen.add(key)
      for (const event of events) {
        const extended = [...trace, event]
        run(extended)
        checked++
        pending.push(extended)
      }
    }
    expect(new Set([...seen].map(key => JSON.parse(key)[0]))).toEqual(new Set(Object.values(S)))
    expect(checked).toBe(seen.size * events.length)
    console.info(`Lifecycle model: ${seen.size} reachable abstract states, ${checked} event edges checked`)
  })
})
