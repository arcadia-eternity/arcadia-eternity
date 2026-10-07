import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import HealthRageBar from '../HealthRageBar.vue'

it('shrinks and changes color together without a delayed damage trail', async () => {
  const bar = mount(HealthRageBar, { props: { current: 100, max: 100 } })
  await bar.setProps({ current: 20 })
  const fill = bar.get('.battle-bars__fill').element as HTMLElement
  expect(fill.style.transform).toBe('scaleX(0.2)')
  expect(fill.style.backgroundColor).not.toBe('')
  expect(bar.find('.battle-bars__trail').exists()).toBe(false)
  expect(bar.find('.battle-bars__fill--low').exists()).toBe(false)
  bar.unmount()
})

it('renders original vector digits and keeps effective modifier values and mirrored anchoring', () => {
  const bar = mount(HealthRageBar, {
    props: {
      current: 447,
      max: 499,
      rage: 54,
      reverse: true,
      currentHpModifierInfo: { isModified: true, currentValue: 123, modifiers: [] } as never,
    },
  })
  expect(bar.classes()).toContain('battle-bars--reverse')
  expect(bar.find('[aria-label="123"]').exists()).toBe(true)
  expect(bar.find('svg defs g').attributes('id')).toBe('hp-1-shape0')
  expect(bar.findAll('svg')).toHaveLength(13)
  bar.unmount()
})

it('clips only bar artwork and keeps every number outside the clipping layer', () => {
  const bar = mount(HealthRageBar, { props: { current: 499, max: 499, rage: 100 } })
  for (const row of bar.findAll('.battle-bars__row')) {
    expect(row.get('.battle-bars__visual').find('.battle-bars__fill').exists()).toBe(true)
    expect(row.get('.battle-bars__value').element.closest('.battle-bars__visual')).toBeNull()
    expect(row.get('.battle-bars__visual').find('svg').exists()).toBe(false)
  }
  bar.unmount()
})
