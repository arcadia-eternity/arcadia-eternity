import mitt from 'mitt'
import { afterEach, expect, it, vi } from 'vitest'
import { waitForSkillAnimation } from '../skillAnimationWait'

type Events = { 'attack-hit': 'left' | 'right'; 'animation-complete': 'left' | 'right' }
afterEach(() => vi.useRealTimers())
it('does not trigger impact before a late hit in a five-second attack', async () => {
  vi.useFakeTimers()
  const events = mitt<Events>()
  const wait = waitForSkillAnimation(events, 'left', 5000)
  const impact = vi.fn()
  void wait.hit.then(impact)
  await vi.advanceTimersByTimeAsync(2000)
  expect(impact).not.toHaveBeenCalled()
  events.emit('attack-hit', 'right')
  await Promise.resolve()
  expect(impact).not.toHaveBeenCalled()
  events.emit('attack-hit', 'left')
  await Promise.resolve()
  expect(impact).toHaveBeenCalledOnce()
  wait.cancel()
  expect(events.all.get('attack-hit')).toHaveLength(0)
})
it('uses animation completion when the sprite has no hit marker', async () => {
  vi.useFakeTimers()
  const events = mitt<Events>()
  const wait = waitForSkillAnimation(events, 'right', 5000)
  events.emit('animation-complete', 'right')
  await Promise.all([wait.hit, wait.complete])
  expect(vi.getTimerCount()).toBe(0)
  expect(events.all.get('animation-complete')).toHaveLength(0)
})
it('has a full-duration fallback for a broken renderer', async () => {
  vi.useFakeTimers()
  const events = mitt<Events>()
  const wait = waitForSkillAnimation(events, 'left', 5000)
  await vi.advanceTimersByTimeAsync(5000)
  await Promise.all([wait.hit, wait.complete])
  expect(vi.getTimerCount()).toBe(0)
})
