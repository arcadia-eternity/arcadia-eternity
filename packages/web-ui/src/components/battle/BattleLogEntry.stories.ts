import type { Meta, StoryObj } from '@storybook/vue3'
import BattleLogEntry from './BattleLogEntry.vue'
import { BattleMessageType } from '@arcadia-eternity/const'

const meta: Meta<typeof BattleLogEntry> = {
  title: 'Components/Battle/BattleLogEntry',
  component: BattleLogEntry,
  tags: ['autodocs'],
  argTypes: {
    message: {
      control: 'object',
      description: '战斗日志消息对象',
    },
  },
}

export default meta

type Story = StoryObj<typeof meta>

// 技能使用消息
export const SkillUse: Story = {
  args: {
    message: {
      type: BattleMessageType.SkillUse,
      icon: '⚡',
      content: '<span class="pet-name">皮卡丘</span> 使用了 <span class="skill-name">十万伏特</span>',
      timestamp: '11:11:11',
    },
  },
  decorators: [
    () => ({
      template: '<div class="bg-black/80 rounded-lg p-4"><story /></div>',
    }),
  ],
}

// 状态变化消息
export const StatChange: Story = {
  args: {
    message: {
      type: BattleMessageType.StatChange,
      icon: '📈',
      content: '<span class="pet-name">皮卡丘</span> 的攻击 <span class="effective">上升了2级</span>',
      timestamp: '11:11:12',
    },
  },
  decorators: [
    () => ({
      template: '<div class="bg-black/80 rounded-lg p-4"><story /></div>',
    }),
  ],
}

// 换宠消息
export const PetSwitch: Story = {
  args: {
    message: {
      type: BattleMessageType.PetSwitch,
      icon: '🔄',
      content:
        '<span class="pet-name">小智</span> 收回了 <span class="pet-name">皮卡丘</span>，放出了 <span class="pet-name">喷火龙</span>',
      timestamp: '11:11:13',
    },
  },
  decorators: [
    () => ({
      template: '<div class="bg-black/80 rounded-lg p-4"><story /></div>',
    }),
  ],
}

// 普通信息消息
export const Info: Story = {
  args: {
    message: {
      type: BattleMessageType.Info,
      icon: 'ℹ️',
      content: '[战斗] 皮卡丘使用了十万伏特！',
      timestamp: '11:11:14',
    },
  },
  decorators: [
    () => ({
      template: '<div class="bg-black/80 rounded-lg p-4"><story /></div>',
    }),
  ],
}
