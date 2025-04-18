import type { Meta, StoryObj } from '@storybook/vue3'
import Mark from './Mark.vue'
import type { baseMarkId, MarkMessage } from '@test-battle/const'
import { nanoid } from 'nanoid'

const meta: Meta<typeof Mark> = {
  title: 'Components/Battle/Mark',
  component: Mark,
  parameters: {
    layout: 'centered',
  },
}

export default meta

type Story = StoryObj<typeof Mark>

const baseMark: MarkMessage = {
  id: nanoid(),
  baseId: 'mark_poison' as baseMarkId,
  stack: 1,
  duration: 3,
  isActive: true,
  config: {},
}

export const Default: Story = {
  render: () => ({
    components: { Mark },
    setup() {
      return { mark: { ...baseMark } }
    },
    template: '<Mark :mark="mark" />',
  }),
}

export const Stacked: Story = {
  render: () => ({
    components: { Mark },
    setup() {
      return { mark: { ...baseMark, stack: 3 } }
    },
    template: '<Mark :mark="mark" />',
  }),
}

export const Expiring: Story = {
  render: () => ({
    components: { Mark },
    setup() {
      return { mark: { ...baseMark, duration: 1 } }
    },
    template: '<Mark :mark="mark" />',
  }),
}

export const Multiple: Story = {
  render: () => ({
    components: { Mark },
    setup() {
      const marks = [
        { ...baseMark, id: nanoid(), baseId: 'mark_poison' },
        { ...baseMark, id: nanoid(), baseId: 'mark_burn', stack: 2 },
        { ...baseMark, id: nanoid(), baseId: 'mark_freeze', duration: 1 },
      ]
      return { marks }
    },
    template: `
      <div class="flex gap-4">
        <Mark v-for="(mark, i) in marks" :key="i" :mark="mark" />
      </div>
    `,
  }),
}
