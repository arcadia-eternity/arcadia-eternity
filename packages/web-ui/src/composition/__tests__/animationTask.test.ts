import { afterEach, expect, it, vi } from 'vitest'
import { waitForAnimationOperation } from '../animationTask'

afterEach(() => vi.useRealTimers())
it.each([1000, undefined])('abort releases a never-returning operation with deadline %s', async timeout => {
  vi.useFakeTimers()
  const abort = new AbortController()
  const result = waitForAnimationOperation(new Promise(() => {}), abort.signal, timeout)
  const check = expect(result).rejects.toMatchObject({ name: 'AbortError' })
  abort.abort()
  await check
  expect(vi.getTimerCount()).toBe(0)
})
it('a hard deadline fires independently and ignores a late result', async () => {
  vi.useFakeTimers()
  let finish!: (value: number) => void
  const result = waitForAnimationOperation(
    new Promise<number>(resolve => {
      finish = resolve
    }),
    new AbortController().signal,
    1000,
  )
  const check = expect(result).rejects.toThrow('动画任务超时')
  await vi.advanceTimersByTimeAsync(1000)
  await check
  finish(1)
  await Promise.resolve()
  expect(vi.getTimerCount()).toBe(0)
})
it('normal completion removes deadline and later abort cannot alter its result', async () => {
  vi.useFakeTimers()
  const abort = new AbortController()
  const result = waitForAnimationOperation(Promise.resolve(7), abort.signal, 1000)
  expect(await result).toBe(7)
  abort.abort()
  expect(await result).toBe(7)
  expect(vi.getTimerCount()).toBe(0)
})
