import type { Meta, StoryObj } from '@storybook/vue3'
import PetButton from './PetButton.vue'
import { Element } from '@test-battle/const'
import i18next from 'i18next'

const meta: Meta<typeof PetButton> = {
  title: 'Components/PetButton',
  component: PetButton,
}

export default meta

type Story = StoryObj<typeof PetButton>

const mockPet = {
  id: 'pet-1',
  name: '小火龙',
  speciesID: 4,
  element: Element.Fire,
  level: 50,
  currentHp: 75,
  maxHp: 100,
  skills: [
    {
      id: 'skill-1',
      baseId: 'ember',
      rage: 50,
      power: 40,
      element: Element.Fire,
    },
    {
      id: 'skill-2',
      baseId: 'scratch',
      rage: 0,
      power: 40,
      element: Element.Normal,
    },
  ],
  isUnknown: false,
  marks: [],
}

export const LeftPosition: Story = {
  render: () => ({
    components: { PetButton },
    setup() {
      return { pet: mockPet }
    },
    template: '<PetButton :pet="pet" position="left" />',
  }),
}

export const RightPosition: Story = {
  render: () => ({
    components: { PetButton },
    setup() {
      return { pet: mockPet }
    },
    template: '<PetButton :pet="pet" position="right" />',
  }),
}

export const BottomPosition: Story = {
  render: () => ({
    components: { PetButton },
    setup() {
      return { pet: mockPet }
    },
    template: '<PetButton :pet="pet" position="bottom" />',
  }),
}

export const Disabled: Story = {
  render: () => ({
    components: { PetButton },
    setup() {
      return { pet: mockPet }
    },
    template: '<PetButton :pet="pet" position="left" disabled />',
  }),
}

export const Active: Story = {
  render: () => ({
    components: { PetButton },
    setup() {
      return { pet: mockPet }
    },
    template: '<PetButton :pet="pet" position="left" :isActive="true" />',
  }),
}
