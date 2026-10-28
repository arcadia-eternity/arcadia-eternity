import { describe, test, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { h } from 'vue'
import ModifiedValue from '../ModifiedValue.vue'
import type { AttributeModifierInfo } from '@arcadia-eternity/const'

describe('ModifiedValue Component', () => {
  test.each([
    { baseValue: 100, currentValue: 120 },
    { baseValue: false, currentValue: true },
    { baseValue: 'before', currentValue: 'after' },
  ])('preserves the slot value type ($currentValue)', ({ baseValue, currentValue }) => {
    const slot = vi.fn(({ value }: { value: number | string | boolean }) => h('span', String(value)))
    const wrapper = mount(ModifiedValue, {
      props: {
        value: baseValue,
        attributeInfo: { attributeName: 'custom', baseValue, currentValue, isModified: true, modifiers: [] },
      },
      slots: { default: slot },
    })
    expect(slot).toHaveBeenLastCalledWith(expect.objectContaining({ value: currentValue }))
    expect(wrapper.text()).toBe(String(currentValue))
    wrapper.unmount()
  })

  test('formats percentages before and after the modifier changes', async () => {
    const attributeInfo: AttributeModifierInfo<number> = {
      attributeName: 'critRate',
      baseValue: 10,
      currentValue: 25,
      isModified: false,
      modifiers: [],
    }
    const wrapper = mount(ModifiedValue, {
      props: { value: 10, attributeInfo, format: (value: number) => `${value}%` },
    })
    expect(wrapper.text()).toBe('10%')
    await wrapper.setProps({ attributeInfo: { ...attributeInfo, isModified: true } })
    expect(wrapper.text()).toBe('25%')
    wrapper.unmount()
  })

  test('passes the numeric value to the slot even when text formatting is configured', () => {
    const slot = vi.fn(({ value }: { value: number }) => h('span', value.toFixed(1)))
    const wrapper = mount(ModifiedValue, {
      props: { value: 10, format: (value: number) => `${value}%` },
      slots: { default: slot },
    })
    expect(slot).toHaveBeenLastCalledWith(expect.objectContaining({ value: 10 }))
    expect(wrapper.text()).toBe('10.0')
    wrapper.unmount()
  })

  test('should display normal value without modifiers', () => {
    const wrapper = mount(ModifiedValue, {
      props: {
        value: 100,
      },
    })

    expect(wrapper.text()).toBe('100')
    expect(wrapper.find('.text-green-400').exists()).toBe(false)
  })

  test('should display buffed value with green color', () => {
    const attributeInfo: AttributeModifierInfo<number> = {
      attributeName: 'atk',
      baseValue: 100,
      currentValue: 120,
      isModified: true,
      modifiers: [
        {
          id: 'buff-1',
          type: 'delta',
          value: 20,
          priority: 0,
          sourceType: 'skill',
          sourceId: 'skill-123',
          sourceName: 'Power Boost',
        },
      ],
    }

    const wrapper = mount(ModifiedValue, {
      props: {
        value: 120,
        attributeInfo,
      },
    })

    expect(wrapper.text()).toBe('120')
    expect(wrapper.find('.text-green-400').exists()).toBe(true)
  })

  test('should display debuffed value with red color', () => {
    const attributeInfo: AttributeModifierInfo<number> = {
      attributeName: 'atk',
      baseValue: 100,
      currentValue: 80,
      isModified: true,
      modifiers: [
        {
          id: 'debuff-1',
          type: 'delta',
          value: -20,
          priority: 0,
          sourceType: 'mark',
          sourceId: 'mark-123',
          sourceName: 'Weakness',
        },
      ],
    }

    const wrapper = mount(ModifiedValue, {
      props: {
        value: 80,
        attributeInfo,
      },
    })

    expect(wrapper.text()).toBe('80')
    expect(wrapper.find('.text-red-400').exists()).toBe(true)
  })

  test('should display clamped value with orange color', () => {
    const attributeInfo: AttributeModifierInfo<number> = {
      attributeName: 'atk',
      baseValue: 100,
      currentValue: 90,
      isModified: true,
      modifiers: [
        {
          id: 'clamp-1',
          type: 'clampMax',
          value: 90,
          priority: 0,
          sourceType: 'other',
        },
      ],
    }

    const wrapper = mount(ModifiedValue, {
      props: {
        value: 90,
        attributeInfo,
      },
    })

    expect(wrapper.text()).toBe('90')
    expect(wrapper.find('.text-orange-400').exists()).toBe(true)
  })

  test('should display mixed effects with purple color', () => {
    const attributeInfo: AttributeModifierInfo<number> = {
      attributeName: 'atk',
      baseValue: 100,
      currentValue: 110,
      isModified: true,
      modifiers: [
        {
          id: 'buff-1',
          type: 'delta',
          value: 20,
          priority: 1,
          sourceType: 'skill',
        },
        {
          id: 'debuff-1',
          type: 'delta',
          value: -10,
          priority: 0,
          sourceType: 'mark',
        },
      ],
    }

    const wrapper = mount(ModifiedValue, {
      props: {
        value: 110,
        attributeInfo,
      },
    })

    expect(wrapper.text()).toBe('110')
    expect(wrapper.find('.text-purple-400').exists()).toBe(true)
  })

  test('should work with inline prop', () => {
    const wrapper = mount(ModifiedValue, {
      props: {
        value: 100,
        inline: true,
      },
    })

    expect(wrapper.find('.inline-block').exists()).toBe(true)
  })

  test('should work with different sizes', () => {
    const wrapperSm = mount(ModifiedValue, {
      props: {
        value: 100,
        size: 'sm',
      },
    })

    const wrapperLg = mount(ModifiedValue, {
      props: {
        value: 100,
        size: 'lg',
      },
    })

    expect(wrapperSm.find('.text-sm').exists()).toBe(true)
    expect(wrapperLg.find('.text-lg').exists()).toBe(true)
  })
})
