import { test } from '@japa/runner'
import { mount } from '@vue/test-utils'
import ModifiedValue from '../ModifiedValue.vue'
import type { AttributeModifierInfo } from '@arcadia-eternity/const'

test.group('ModifiedValue Component', () => {
  test('should display normal value without modifiers', ({ expect }) => {
    const wrapper = mount(ModifiedValue, {
      props: {
        value: 100,
      },
    })

    expect(wrapper.text()).toBe('100')
    expect(wrapper.find('.text-green-400').exists()).toBe(false)
  })

  test('should display buffed value with green color', ({ expect }) => {
    const attributeInfo: AttributeModifierInfo = {
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

  test('should display debuffed value with red color', ({ expect }) => {
    const attributeInfo: AttributeModifierInfo = {
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

  test('should display clamped value with orange color', ({ expect }) => {
    const attributeInfo: AttributeModifierInfo = {
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

  test('should display mixed effects with purple color', ({ expect }) => {
    const attributeInfo: AttributeModifierInfo = {
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

  test('should work with inline prop', ({ expect }) => {
    const wrapper = mount(ModifiedValue, {
      props: {
        value: 100,
        inline: true,
      },
    })

    expect(wrapper.find('.inline-block').exists()).toBe(true)
  })

  test('should work with different sizes', ({ expect }) => {
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
