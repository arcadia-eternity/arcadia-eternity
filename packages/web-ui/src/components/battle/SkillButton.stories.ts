import type { Meta, StoryObj } from '@storybook/vue3'
import SkillButton from './SkillButton.vue'
import { Element, Category, AttackTargetOpinion } from '@arcadia-eternity/const'
import type { SkillMessage, baseSkillId, skillId } from '@arcadia-eternity/const'

const meta: Meta<typeof SkillButton> = {
  title: 'Components/Battle/SkillButton',
  component: SkillButton,
  parameters: {
    layout: 'centered',
  },
}

export default meta

type Story = StoryObj<typeof SkillButton>

export const Normal: Story = {
  render: () => ({
    components: { SkillButton },
    setup() {
      const skill: SkillMessage = {
        element: Element.Fire,
        category: Category.Physical,
        power: 120,
        rage: 20,
        accuracy: 95,
        baseId: 'skill1' as baseSkillId,
        id: 'skill1' as skillId,
        isUnknown: false,
        priority: 0,
        target: AttackTargetOpinion.opponent,
        multihit: 1,
        sureHit: false,
        tag: [],
      }
      return { skill }
    },
    template: `<SkillButton :skill="skill" />`,
  }),
}

export const Disabled: Story = {
  render: () => ({
    components: { SkillButton },
    setup() {
      const skill: SkillMessage = {
        element: Element.Water,
        category: Category.Status,
        power: 80,
        rage: 15,
        accuracy: 100,
        baseId: 'skill2' as baseSkillId,
        id: 'skill2' as skillId,
        isUnknown: false,
        priority: 0,
        target: AttackTargetOpinion.opponent,
        multihit: 1,
        sureHit: false,
        tag: [],
      }
      return { skill, disabled: true }
    },
    template: `<SkillButton :skill="skill" :disabled="disabled" />`,
  }),
}

export const Climax: Story = {
  render: () => ({
    components: { SkillButton },
    setup() {
      const skill: SkillMessage = {
        element: Element.Fire,
        category: Category.Climax,
        power: 160,
        rage: 100,
        accuracy: 100,
        baseId: 'skill3' as baseSkillId,
        id: 'skill3' as skillId,
        isUnknown: false,
        priority: 0,
        target: AttackTargetOpinion.opponent,
        multihit: 1,
        sureHit: false,
        tag: [],
      }
      return { skill }
    },
    template: `<SkillButton :skill="skill" />`,
  }),
}
