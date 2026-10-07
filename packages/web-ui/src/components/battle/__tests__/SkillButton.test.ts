import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { Category, Element, type SkillMessage } from '@arcadia-eternity/const'
vi.mock('@/stores/battle', () => ({ useBattleStore: () => ({ opponent: null }) }))
vi.mock('@/stores/gameData', () => ({ useGameDataStore: () => ({ loaded: false }) }))
vi.mock('i18next', () => ({
  default: {
    t: (key: string) =>
      ({
        'skill_test.name': '测试技能',
        'skill_test.description': '测试说明',
        'category.Climax': '必杀',
        'category.Physical': '物理',
        power: '威力',
        rage: '怒气',
        accuracy: '命中',
      })[key] || key,
  },
}))
import SkillButton from '../SkillButton.vue'
const skill = {
  id: 'test',
  baseId: 'skill_test',
  element: Element.Fire,
  category: Category.Physical,
  power: 125,
  rage: 30,
  accuracy: 95,
} as SkillMessage
for (const category of [Category.Physical, Category.Climax]) {
  describe(`${category} skill controls`, () => {
    it('retains all decision information and emits the original skill ID', async () => {
      const wrapper = mount(SkillButton, {
        props: { skill: { ...skill, category } },
        global: {
          stubs: {
            Tooltip: { template: '<div><slot name="trigger" /><slot /></div>' },
            ModifiedValue: { props: ['value'], template: '<span>{{ value }}</span>' },
          },
        },
      })
      const button = wrapper.get('button')
      expect(button.text()).toContain('测试技能')
      for (const value of ['125', '30']) expect(button.text()).toContain(value)
      expect(button.text()).not.toContain('命中')
      expect(button.text()).not.toContain('95')
      expect(wrapper.text()).toContain('命中')
      expect(wrapper.text()).toContain('95')
      expect(button.attributes('aria-label')).toContain('命中 95')
      expect(wrapper.findAll('.battle-skill__particle')).toHaveLength(category === Category.Climax ? 8 : 0)
      await button.trigger('click')
      expect(wrapper.emitted('click')).toEqual([['test']])
      await wrapper.setProps({ disabled: true })
      expect(wrapper.findAll('.battle-skill__particle')).toHaveLength(0)
      await button.trigger('click')
      expect(wrapper.emitted('click')).toHaveLength(1)
    })
  })
}
