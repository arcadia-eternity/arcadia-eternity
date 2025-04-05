import type { Meta, StoryObj } from '@storybook/vue3'
import HealthRageBar from './HealthRageBar.vue'

const meta: Meta<typeof HealthRageBar> = {
  title: 'Components/Battle/HealthRageBar',
  component: HealthRageBar,
}

export default meta

type Story = StoryObj<typeof HealthRageBar>

export const Default: Story = {
  args: {
    current: 500,
    max: 500,
    rage: 0,
    reverse: false,
  },
}

export const LowHealth: Story = {
  args: {
    current: 100,
    max: 500,
    rage: 50,
    reverse: false,
  },
}

export const FullRage: Story = {
  args: {
    current: 300,
    max: 500,
    rage: 100,
    reverse: false,
  },
}

export const Reversed: Story = {
  args: {
    current: 200,
    max: 500,
    rage: 75,
    reverse: true,
  },
}
