import type { Meta, StoryObj } from '@storybook/vue3'
import PetIcon from './PetIcon.vue'

const meta: Meta<typeof PetIcon> = {
  title: 'Components/PetIcon',
  component: PetIcon,
}

export default meta

type Story = StoryObj<typeof PetIcon>

export const Default: Story = {
  render: () => ({
    components: { PetIcon },
    setup() {
      return { id: 1 }
    },
    template: '<PetIcon :id="id" />',
  }),
}

export const DifferentID: Story = {
  render: () => ({
    components: { PetIcon },
    setup() {
      return { id: 999 }
    },
    template: '<PetIcon :id="id" />',
  }),
}

export const Reversed: Story = {
  render: () => ({
    components: { PetIcon },
    setup() {
      return { id: 1, reverse: true }
    },
    template: '<PetIcon :id="id" :reverse="reverse" />',
  }),
}

export const InvalidID: Story = {
  render: () => ({
    components: { PetIcon },
    setup() {
      return { id: 114514 }
    },
    template: '<PetIcon :id="id" />',
  }),
}
