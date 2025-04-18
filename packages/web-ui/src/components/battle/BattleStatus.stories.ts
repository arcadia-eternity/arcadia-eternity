import type { Meta, StoryObj } from '@storybook/vue3'
import BattleStatus from './BattleStatus.vue'
import {
  Element,
  type baseMarkId,
  type markId,
  type petId,
  type playerId,
  type speciesId,
} from '@arcadia-eternity/const'

const mockPlayer = {
  id: 'player1' as playerId,
  name: '玩家1',
  rage: 50,
  teamAlives: 3,
  activePet: 'pet1' as petId,
  team: [
    {
      id: 'pet1' as petId,
      level: 50,
      name: '小火龙',
      speciesID: '1' as speciesId,
      currentHp: 120,
      maxHp: 150,
      element: Element.Fire,
      isUnknown: false,
      marks: [
        {
          id: 'mark1' as markId,
          baseId: '1001' as baseMarkId,
          stack: 1,
          duration: 3,
          isActive: true,
          config: {},
        },
      ],
    },
    {
      id: 'pet1' as petId,
      level: 50,
      name: '小火龙',
      speciesID: '1' as speciesId,
      currentHp: 120,
      maxHp: 150,
      element: Element.Fire,
      isUnknown: false,
      marks: [
        {
          id: 'mark1' as markId,
          baseId: '1001' as baseMarkId,
          stack: 1,
          duration: 3,
          isActive: true,
          config: {},
        },
      ],
    },
    {
      id: 'pet1' as petId,
      level: 50,
      name: '小火龙',
      speciesID: '1' as speciesId,
      currentHp: 120,
      maxHp: 150,
      element: Element.Fire,
      isUnknown: false,
      marks: [
        {
          id: 'mark1' as markId,
          baseId: '1001' as baseMarkId,
          stack: 1,
          duration: 3,
          isActive: true,
          config: {},
        },
      ],
    },
  ],
}

const mockEnemy = {
  id: 'player2' as playerId,
  name: '玩家2',
  rage: 30,
  teamAlives: 3,
  activePet: 'pet2' as petId,
  team: [
    {
      id: 'pet2' as petId,
      level: 48,
      name: '杰尼龟',
      speciesID: '2' as speciesId,
      currentHp: 110,
      maxHp: 130,
      element: Element.Water,
      isUnknown: false,
      marks: [],
    },
  ],
}

const meta: Meta<typeof BattleStatus> = {
  component: BattleStatus,
  title: 'Components/Battle/BattleStatus',
  tags: ['autodocs'],
}

export default meta

type Story = StoryObj<typeof BattleStatus>

export const LeftSide: Story = {
  args: {
    player: mockPlayer,
    side: 'left',
  },
}

export const RightSide: Story = {
  args: {
    player: mockEnemy,
    side: 'right',
  },
}
