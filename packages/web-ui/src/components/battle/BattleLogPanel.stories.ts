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
  type baseSkillId,
} from '@arcadia-eternity/const'
import {
  logMessagesKey,
  type TimestampedBattleMessage,
} from '@/symbol/battlelog'

interface StoryProps {
  messages: TimestampedBattleMessage[]
}

const meta: Meta<StoryProps> = {
  title: 'Components/Battle/BattleLogPanel',
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
            stateDelta: {},
            receivedAt: Date.now(),
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
            stateDelta: {},
            receivedAt: Date.now() - 3000,
          },
          {
            sequenceId: 2,
            type: BattleMessageType.SkillUse,
            data: {
              user: 'pet_001' as petId,
              target: AttackTargetOpinion.opponent,
              skill: 'skill_001' as skillId,
              baseSkill: 'skill_001' as baseSkillId,
              rage: 30,
            },
            stateDelta: {},
            receivedAt: Date.now() - 2000,
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
            stateDelta: {},
            receivedAt: Date.now() - 1000,
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
            stateDelta: {},
            receivedAt: Date.now() - (20 - i) * 1000, // 每条消息间隔1秒
          })) as TimestampedBattleMessage[],
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
