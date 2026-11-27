import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import HealthRageBar from '../HealthRageBar.vue'

afterEach(() => vi.unstubAllGlobals())

function mockAnimationFrames() {
  let time = 0
  let id = 0
  const callbacks = new Map<number, FrameRequestCallback>()
  vi.stubGlobal('performance', { now: () => time })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callbacks.set(++id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id))
  return async (ms: number) => {
    time += ms
    const pending = [...callbacks.values()]
    callbacks.clear()
    pending.forEach(callback => callback(time))
    await nextTick()
  }
}

const hp = '[role="meter"][aria-label="生命值"]'
const rage = '[role="meter"][aria-label="怒气"]'

it.each([
  [140, '1', 'rgb(119, 226, 12)', 'rgb(248, 121, 7)'],
  [100, '1', 'rgb(119, 226, 12)', 'rgb(248, 121, 7)'],
  [50, '20', 'rgb(255, 255, 0)', 'rgb(252, 61, 4)'],
  [1, '39', 'rgb(255, 0, 0)', 'rgb(255, 0, 0)'],
  [0, '40', undefined, undefined],
])('maps a meter at %s%% to frame %s and its fill colors', (value, frame, hpColor, rageColor) => {
  const bar = mount(HealthRageBar, { props: { current: value, max: 100, rage: value } })
  for (const [selector, color] of [
    [hp, hpColor],
    [rage, rageColor],
  ] as const) {
    const visual = bar.get(`${selector} .battle-bars__visual`)
    expect(visual.attributes('data-frame')).toBe(frame)
    if (color) expect(visual.get('stop[offset="1"]').attributes('stop-color')).toBe(color)
    else expect(visual.find('.battle-bars__fill').exists()).toBe(false)
  }
  if (frame === '1') expect(bar.get(`${hp} .battle-bars__fill`).attributes('transform')).toBe('scale(0.9629822 1)')
  bar.unmount()
})

it('moves HP smoothly in both directions at the 24 fps pace while numbers update immediately', async () => {
  const advance = mockAnimationFrames()
  const bar = mount(HealthRageBar, { props: { current: 100, max: 100 } })
  const visual = bar.get(`${hp} .battle-bars__visual`)
  const scale = () => Number(/scale\(([\d.]+)/.exec(bar.get(`${hp} .battle-bars__fill`).attributes('transform')!)![1])
  await bar.setProps({ current: 0 })
  expect(bar.get(hp).attributes('aria-valuenow')).toBe('0')
  expect(bar.find(`${hp} .battle-bars__value [aria-label="0"]`).exists()).toBe(true)
  await advance(1000 / 48)
  expect(scale()).toBeCloseTo(0.9629822 - (0.9629822 - 0.007675171) / 76, 6)
  await advance(1000 / 48)
  expect(visual.attributes('data-frame')).toBe('2')
  await advance(1000 / 120)
  expect(scale()).toBeCloseTo(0.9629822 - ((0.9629822 - 0.007675171) * 1.2) / 38, 6)
  await advance(1583)
  expect(visual.attributes('data-frame')).toBe('40')
  expect(bar.find('.battle-bars__trail').exists()).toBe(false)
  await bar.setProps({ current: 50 })
  await advance(42)
  expect(visual.attributes('data-frame')).toBe('39')
  await advance(792)
  expect(visual.attributes('data-frame')).toBe('20')
  bar.unmount()
})

it('queues rage targets until each frame is reached', async () => {
  const advance = mockAnimationFrames()
  const bar = mount(HealthRageBar, { props: { current: 100, max: 100, rage: 100 } })
  const visual = bar.get(`${rage} .battle-bars__visual`)
  await bar.setProps({ rage: 50 })
  await bar.setProps({ rage: 100 })
  expect(bar.get(rage).attributes('aria-valuenow')).toBe('100')
  await advance(792)
  expect(visual.attributes('data-frame')).toBe('20')
  await advance(792)
  expect(visual.attributes('data-frame')).toBe('1')
  bar.unmount()
})

it.each(['simple', 'reduced'])('jumps immediately with shell motion set to %s', async motion => {
  const shell = document.createElement('div')
  shell.className = 'battle-shell'
  shell.dataset.motion = motion
  const bar = mount(HealthRageBar, { attachTo: shell, props: { current: 100, max: 100 } })
  await bar.setProps({ current: 50 })
  expect(bar.get(`${hp} .battle-bars__visual`).attributes('data-frame')).toBe('20')
  bar.unmount()
})

it('clears pending rage targets when the shell switches to reduced motion', async () => {
  const advance = mockAnimationFrames()
  const shell = document.createElement('div')
  shell.className = 'battle-shell'
  shell.dataset.motion = 'standard'
  const bar = mount(HealthRageBar, { attachTo: shell, props: { current: 100, max: 100, rage: 100 } })
  const visual = bar.get(`${rage} .battle-bars__visual`)
  await bar.setProps({ rage: 50 })
  await bar.setProps({ rage: 0 })
  await advance(42)
  expect(visual.attributes('data-frame')).toBe('2')
  shell.dataset.motion = 'reduced'
  await new Promise<void>(resolve => setTimeout(resolve, 0))
  expect(visual.attributes('data-frame')).toBe('40')
  shell.dataset.motion = 'standard'
  await new Promise<void>(resolve => setTimeout(resolve, 0))
  await advance(1000)
  expect(visual.attributes('data-frame')).toBe('40')
  bar.unmount()
})

it('jumps immediately with the reduced-motion media query', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
  const bar = mount(HealthRageBar, { props: { current: 100, max: 100 } })
  await bar.setProps({ current: 0, rage: 50 })
  expect(bar.get(`${hp} .battle-bars__visual`).attributes('data-frame')).toBe('40')
  expect(bar.get(`${rage} .battle-bars__visual`).attributes('data-frame')).toBe('20')
  bar.unmount()
})

it('keeps mirrored artwork separate from the readable SVG numbers and exposes both meters', () => {
  const bar = mount(HealthRageBar, {
    props: {
      current: 447,
      max: 499,
      rage: 54,
      maxRage: 120,
      reverse: true,
      currentHpModifierInfo: {
        attributeName: 'currentHp',
        baseValue: 447,
        isModified: true,
        currentValue: 123,
        modifiers: [],
      },
    },
  })
  expect(bar.classes()).toContain('battle-bars--reverse')
  expect(bar.get(hp).attributes()).toMatchObject({
    'aria-valuemin': '0',
    'aria-valuenow': '447',
    'aria-valuemax': '499',
  })
  expect(bar.get(rage).attributes()).toMatchObject({
    'aria-valuemin': '0',
    'aria-valuenow': '54',
    'aria-valuemax': '120',
  })
  expect(bar.find(`${hp} .battle-bars__value [aria-label="123"]`).exists()).toBe(true)
  for (const meter of bar.findAll('[role="meter"]')) {
    expect(meter.get('.battle-bars__value').element.closest('.battle-bars__visual')).toBeNull()
    expect(meter.find('.battle-bars__value svg').exists()).toBe(true)
  }
  bar.unmount()
})
