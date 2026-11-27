import { nextTick } from 'vue'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BattleLoading from '../BattleLoading.vue'

const { playLoadingSound } = vi.hoisted(() => ({ playLoadingSound: vi.fn() }))
vi.mock('@/composition/sound', () => ({ useSound: () => ({ playLoadingSound }) }))
vi.mock('@/stores/gameData', () => ({ useGameDataStore: () => ({ getSpecies: vi.fn() }) }))

enableAutoUnmount(afterEach)
beforeEach(() => {
  playLoadingSound.mockClear()
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

function loader(props: Partial<InstanceType<typeof BattleLoading>['$props']> = {}) {
  return mount(BattleLoading, {
    props: { tasks: [], progress: 0, error: null, ...props },
    global: { stubs: { PetIcon: true } },
  })
}

describe('BattleLoading', () => {
  it('renders progress without leading zeros or backwards jumps', async () => {
    const wrapper = loader({ progress: 7 })
    const progressbar = wrapper.get('[role="progressbar"]')
    const shown = () =>
      progressbar
        .findAll('[data-digit]')
        .map(digit => digit.attributes('data-digit'))
        .join('')
    expect(shown()).toBe('7')
    expect(progressbar.attributes('aria-valuetext')).toBe('7%')
    await wrapper.setProps({ progress: 42 })
    expect(shown()).toBe('42')
    expect(progressbar.attributes('aria-valuenow')).toBe('42')
    await wrapper.setProps({ progress: 39 })
    expect(shown()).toBe('42')
  })

  it('announces the active task and marks degraded tasks on replay', () => {
    const wrapper = loader({
      replay: true,
      tasks: [
        { id: 'data', label: '对局数据', state: 'ready' },
        { id: 'background', label: '战斗场景', state: 'degraded' },
        { id: 'pets', label: '首发精灵', state: 'loading' },
      ],
    })
    expect(wrapper.get('h1').text()).toBe('战斗回放')
    expect(wrapper.get('li[data-state="ready"]').text()).toBe('对局数据')
    expect(wrapper.get('li[data-state="degraded"]').text()).toContain('简化显示')
    expect(wrapper.get('[role="status"]').text()).toBe('首发精灵')
  })

  it('emits retry and exit without playing the vanish cue on error', async () => {
    const wrapper = loader({ error: '资源准备超时', progress: 100 })
    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toContain('资源准备超时')
    const [retry, exit] = alert.findAll('button')
    await retry!.trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('0')
    await exit!.trigger('click')
    expect(wrapper.emitted('exit')).toHaveLength(1)
    expect(playLoadingSound).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2000)
    expect(wrapper.emitted('finished')).toBeUndefined()
  })

  it.each([
    ['standard', 2500, 1042],
    ['simple', 0, 140],
    ['reduced', 0, 140],
  ] as const)(
    'holds the %s entrance for %ims, then plays the vanish cue once and exits in %ims',
    async (motion, dwell, duration) => {
      const wrapper = loader({ motion })
      expect(playLoadingSound.mock.calls).toEqual([['enter']])
      await wrapper.setProps({ progress: 100 })
      expect(wrapper.get('[role="progressbar"]').attributes('aria-valuetext')).toBe('100%')
      if (dwell) {
        vi.advanceTimersByTime(dwell - 1)
        await nextTick()
        expect(wrapper.classes()).not.toContain('battle-loading--exiting')
        expect(playLoadingSound.mock.calls).toEqual([['enter']])
        vi.advanceTimersByTime(1)
        await nextTick()
      }
      expect(wrapper.classes()).toContain('battle-loading--exiting')
      await wrapper.setProps({ replay: true })
      expect(playLoadingSound.mock.calls).toEqual([['enter'], ['vanish']])
      vi.advanceTimersByTime(duration - 1)
      expect(wrapper.emitted('finished')).toBeUndefined()
      vi.advanceTimersByTime(1)
      expect(wrapper.emitted('finished')).toHaveLength(1)
    },
  )

  it('vanishes immediately when loading finishes after the entrance has played', async () => {
    const wrapper = loader({ progress: 60 })
    vi.advanceTimersByTime(4000)
    await wrapper.setProps({ progress: 100 })
    expect(wrapper.classes()).toContain('battle-loading--exiting')
    expect(playLoadingSound.mock.calls).toEqual([['enter'], ['vanish']])
  })
})
