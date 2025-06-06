import type { Meta, StoryObj } from '@storybook/vue3'
import PetButton from './PetButton.vue'
import { Element, Category, AttackTargetOpinion } from '@arcadia-eternity/const'
import i18next from 'i18next'

const meta: Meta<typeof PetButton> = {
  title: 'Components/Battle/PetButton',
  component: PetButton,
  parameters: {
    layout: 'centered',
  },
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
      category: Category.Physical,
      accuracy: 100,
      priority: 0,
      target: AttackTargetOpinion.opponent,
      multihit: 1,
      sureHit: false,
      tag: [],
      isUnknown: false,
    },
    {
      id: 'skill-2',
      baseId: 'scratch',
      rage: 0,
      power: 40,
      element: Element.Normal,
      category: Category.Physical,
      accuracy: 100,
      priority: 0,
      target: AttackTargetOpinion.opponent,
      multihit: 1,
      sureHit: false,
      tag: [],
      isUnknown: false,
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

// 未知精灵测试
const unknownPet = {
  id: 'pet-unknown',
  name: '',
  speciesID: 'unknown_species',
  element: Element.Normal,
  level: 0,
  currentHp: 0,
  maxHp: 0,
  skills: [],
  isUnknown: true,
  marks: [],
}

export const UnknownPet: Story = {
  render: () => ({
    components: { PetButton },
    setup() {
      return { pet: unknownPet }
    },
    template: '<PetButton :pet="pet" position="left" />',
  }),
}

// 部分未知技能的精灵
const petWithUnknownSkills = {
  id: 'pet-partial-unknown',
  name: '小火龙',
  speciesID: 4,
  element: Element.Fire,
  level: 50,
  currentHp: 75,
  maxHp: 100,
  skills: [
    {
      id: 'skill-known',
      baseId: 'ember',
      rage: 50,
      power: 40,
      element: Element.Fire,
      category: Category.Special,
      accuracy: 100,
      priority: 0,
      target: AttackTargetOpinion.opponent,
      multihit: 1,
      sureHit: false,
      tag: [],
      isUnknown: false,
    },
    {
      id: 'skill-unknown',
      baseId: '',
      rage: 0,
      power: 0,
      element: Element.Normal,
      category: Category.Physical,
      accuracy: 0,
      priority: 0,
      target: AttackTargetOpinion.opponent,
      multihit: 1,
      sureHit: false,
      tag: [],
      isUnknown: true,
    },
  ],
  isUnknown: false,
  marks: [],
}

export const PetWithUnknownSkills: Story = {
  render: () => ({
    components: { PetButton },
    setup() {
      return { pet: petWithUnknownSkills }
    },
    template: '<PetButton :pet="pet" position="bottom" />',
  }),
}
