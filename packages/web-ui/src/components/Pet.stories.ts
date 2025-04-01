import type { Meta, StoryObj } from '@storybook/vue3'
import Pet from './Pet.vue'

const meta: Meta<typeof Pet> = {
  title: 'Components/Pet',
  component: Pet,
}

export default meta

type Story = StoryObj<typeof Pet>

export const Default: Story = {
  render: () => ({
    components: { Pet },
    setup() {
      return { num: 1 }
    },
    template: '<Pet :num="num" />',
  }),
}

export const Reversed: Story = {
  render: () => ({
    components: { Pet },
    setup() {
      return { num: 1, reverse: true }
    },
    template: '<Pet :num="num" :reverse="reverse" />',
  }),
}

export const ErrorState: Story = {
  render: () => ({
    components: { Pet },
    setup() {
      return { num: 9999 }
    },
    template: '<Pet :num="num" />',
  }),
}
