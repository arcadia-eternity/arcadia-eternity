import type { Meta, StoryObj } from '@storybook/vue3'
import BattleLogPanel from './BattleLogPanel.vue'
import { ref, provide } from 'vue'
import {
  BattleMessageType,
  type BattleMessage,
  type petId,
  type skillId,
  AttackTargetOpinion,
  type StatTypeOnBattle,
} from '@test-battle/const'
import { logMessagesKey, petMapKey, skillMapKey, playerMapKey, markMapKey } from '@/symbol/battlelog'

interface StoryProps {
  messages: BattleMessage[]
}

const meta: Meta<StoryProps> = {
  title: 'Components/BattleLogPanel',
  component: BattleLogPanel,
  tags: ['autodocs'],
  argTypes: {
    messages: {
      control: 'object',
      description: '战斗日志消息数组',
    },
  },
  decorators: [
    () => ({
      setup() {
        provide(logMessagesKey, [])
        provide(petMapKey, new Map())
        provide(skillMapKey, new Map())
        provide(playerMapKey, new Map())
        provide(markMapKey, new Map())
        return {}
      },
      template: '<div class="bg-black/80 rounded-lg p-4"><story /></div>',
    }),
  ],
}

export default meta

type Story = StoryObj<typeof meta>

// 空消息列表
export const Empty: Story = {
  args: {},
  decorators: [
    () => ({
      setup() {
        provide(logMessagesKey, [])
        provide(petMapKey, new Map())
        provide(skillMapKey, new Map())
        provide(playerMapKey, new Map())
        provide(markMapKey, new Map())
        return {}
      },
      template: '<div class="bg-black/80 rounded-lg p-4"><story /></div>',
    }),
  ],
}

// 单条消息
export const SingleMessage: Story = {
  args: {},
  decorators: [
    () => ({
      setup() {
        provide(logMessagesKey, [
          {
            sequenceId: 1,
            type: BattleMessageType.Info,
            data: {
              message: '[战斗] 战斗开始！',
            },
          },
        ])
        provide(petMapKey, new Map())
        provide(skillMapKey, new Map())
        provide(playerMapKey, new Map())
        provide(markMapKey, new Map())
        return {}
      },
      template: '<div class="bg-black/80 rounded-lg p-4"><story /></div>',
    }),
  ],
}

// 多条消息
export const MultipleMessages: Story = {
  args: {},
  decorators: [
    () => ({
      setup() {
        provide(logMessagesKey, [
          {
            sequenceId: 1,
            type: BattleMessageType.Info,
            data: {
              message: '[战斗] 战斗开始！',
            },
          },
          {
            sequenceId: 2,
            type: BattleMessageType.SkillUse,
            data: {
              user: 'pet_001' as petId,
              target: AttackTargetOpinion.opponent,
              skill: 'skill_001' as skillId,
              rageCost: 30,
            },
          },
          {
            sequenceId: 3,
            type: BattleMessageType.StatChange,
            data: {
              pet: 'pet_001' as petId,
              stat: 'attack' as StatTypeOnBattle,
              stage: 2,
              reason: '技能效果',
            },
          },
        ])
        provide(petMapKey, new Map())
        provide(skillMapKey, new Map())
        provide(playerMapKey, new Map())
        provide(markMapKey, new Map())
        return {}
      },
      template: '<div class="bg-black/80 rounded-lg p-4"><story /></div>',
    }),
  ],
}

// 长消息列表（测试滚动）
export const LongMessages: Story = {
  args: {},
  decorators: [
    () => ({
      setup() {
        provide(
          logMessagesKey,
          Array.from({ length: 20 }, (_, i) => ({
            sequenceId: i + 1,
            type: BattleMessageType.Info,
            data: {
              message: `[战斗] 这是第${i + 1}条测试消息，用于测试滚动条功能`,
            },
          })) as BattleMessage[],
        )
        provide(petMapKey, new Map())
        provide(skillMapKey, new Map())
        provide(playerMapKey, new Map())
        provide(markMapKey, new Map())
        return {}
      },
      template: '<div class="bg-black/80 rounded-lg p-4"><story /></div>',
    }),
  ],
}
