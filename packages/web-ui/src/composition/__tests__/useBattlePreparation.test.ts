import { describe, expect, it, vi } from 'vitest'
import { useBattlePreparation, withDeadline } from '../useBattlePreparation'

describe('battle preparation', () => {
  it('blocks on required failure and retries with fresh task states', async () => {
    const preparation = useBattlePreparation()
    const next = vi.fn().mockResolvedValue(undefined)
    await preparation.prepare([
      {
        id: 'data',
        label: '数据',
        required: true,
        run: async () => {
          throw new Error('数据不可用')
        },
      },
      { id: 'sprite', label: '动画', run: next },
    ])
    expect(preparation.ready.value).toBe(false)
    expect(preparation.error.value).toBe('数据不可用')
    expect(next).not.toHaveBeenCalled()
    expect(preparation.progress.value).toBeLessThan(100)
    await preparation.prepare([{ id: 'data', label: '数据', required: true, run: next }])
    expect(preparation.ready.value).toBe(true)
    expect(preparation.error.value).toBeNull()
    expect(preparation.progress.value).toBe(100)
  })

  it('records an optional failure as degradation instead of successful readiness', async () => {
    const preparation = useBattlePreparation()
    await preparation.prepare([
      {
        id: 'sprite',
        label: '精灵',
        run: async () => {
          throw new Error('失败')
        },
      },
    ])
    expect(preparation.tasks.value[0].state).toBe('degraded')
    expect(preparation.degraded.value).toEqual(['精灵'])
    expect(preparation.ready.value).toBe(true)
  })

  it('ignores completion of a cancelled generation', async () => {
    const preparation = useBattlePreparation()
    let finish!: () => void
    const old = preparation.prepare([
      {
        id: 'old',
        label: '旧资源',
        run: () =>
          new Promise<void>(resolve => {
            finish = resolve
          }),
      },
    ])
    preparation.cancel()
    await preparation.prepare([{ id: 'new', label: '新资源', run: async () => {} }])
    finish()
    await old
    expect(preparation.tasks.value.map(t => t.id)).toEqual(['new'])
    expect(preparation.ready.value).toBe(true)
  })

  it('bounds a hung resource and clears the deadline on success', async () => {
    vi.useFakeTimers()
    try {
      const failure = expect(withDeadline(new Promise(() => {}), 500)).rejects.toThrow('资源准备超时')
      await vi.advanceTimersByTimeAsync(500)
      await failure
      await expect(withDeadline(Promise.resolve('ready'), 500)).resolves.toBe('ready')
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
