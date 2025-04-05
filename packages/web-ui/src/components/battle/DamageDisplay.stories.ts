import type { Meta, StoryObj } from '@storybook/vue3'
import DamageDisplay from './DamageDisplay.vue'

const meta: Meta<typeof DamageDisplay> = {
  title: 'Components/Battle/DamageDisplay',
  component: DamageDisplay,
  argTypes: {
    value: {
      control: { type: 'number', min: 1 },
      defaultValue: 123,
    },
    type: {
      control: { type: 'select' },
      options: ['', 'blue', 'red'],
      defaultValue: '',
    },
  },
}

export default meta
type Story = StoryObj<typeof DamageDisplay>

export const Default: Story = {
  args: {
    value: 123,
    type: '',
  },
}
