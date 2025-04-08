import type { Meta, StoryObj } from '@storybook/vue3'
import PetSprite from './PetSprite.vue'

const meta: Meta<typeof PetSprite> = {
  title: 'Components/Battle/PetSprite',
  component: PetSprite,
  tags: ['autodocs'],
  argTypes: {
    num: {
      control: 'number',
      description: '宠物编号',
    },
    reverse: {
      control: 'boolean',
      description: '是否反转显示',
    },
  },
  args: {
    num: 999,
    reverse: false,
  },
  parameters: {
    layout: 'center',
  },
} satisfies Meta<typeof PetSprite>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    num: 999,
  },
}

export const SpecificPet: Story = {
  args: {
    num: 1,
  },
}

export const Reversed: Story = {
  args: {
    num: 1,
    reverse: true,
  },
}

export const Animated: Story = {
  args: {
    num: 1,
  },
}

export const Combined: Story = {
  args: {
    num: 1,
    reverse: true,
  },
}
