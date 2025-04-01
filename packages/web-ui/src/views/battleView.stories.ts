import type { Meta, StoryObj } from '@storybook/vue3'
import BattleView from './battle.vue'
import { Element, Category, AttackTargetOpinion } from '@test-battle/const'
import type { markId, speciesId, baseMarkId, baseSkillId, petId, skillId, playerId } from '@test-battle/const'
import { ref, type ComponentPublicInstance } from 'vue'

const meta: Meta<typeof BattleView> = {
  title: 'Views/BattleView',
  component: BattleView,
  tags: ['autodocs'],
  argTypes: {
    background: { control: 'text' },
    turns: { control: 'number' },
  },
} satisfies Meta<typeof BattleView>

export default meta

type Story = StoryObj<typeof meta>

// 基础数据定义
const basePlayer = (side: 'left' | 'right') => ({
  id: `player${side}` as unknown as playerId,
  name: `玩家${side === 'left' ? 1 : 2}`,
  rage: side === 'left' ? 50 : 30,
  teamAlives: 3,
})

const basePet = (element: Element) => ({
  id: 'pet1' as unknown as petId,
  level: 50,
  name: element === Element.Fire ? '小火龙' : '杰尼龟',
  speciesID: '1' as unknown as speciesId,
  currentHp: element === Element.Fire ? 120 : 110,
  maxHp: element === Element.Fire ? 150 : 130,
  element,
  isUnknown: false,
  marks: [],
})

// 默认故事参数
const defaultArgs = {
  background: 'https://cdn.jsdelivr.net/gh/arcadia-star/seer2-resource@main/png/battleBackground/grass.png',
  turns: 1,
  globalMarks: [],
  skills: [
    {
      id: 'skill2' as unknown as skillId,
      element: Element.Normal,
      category: Category.Physical,
      power: 40,
      rage: 10,
      accuracy: 100,
      isUnknown: false,
      baseId: '1002' as unknown as baseSkillId,
      priority: 0,
      target: AttackTargetOpinion.opponent,
      multihit: 1,
      sureHit: false,
      tag: [],
    },
    {
      id: 'skill3' as unknown as skillId,
      element: Element.Normal,
      category: Category.Status,
      power: 0,
      rage: 15,
      accuracy: 100,
      isUnknown: false,
      baseId: '1003' as unknown as baseSkillId,
      priority: 0,
      target: AttackTargetOpinion.self,
      multihit: 1,
      sureHit: false,
      tag: [],
    },
    {
      id: 'skill4' as unknown as skillId,
      element: Element.Normal,
      category: Category.Status,
      power: 0,
      rage: 10,
      accuracy: 100,
      isUnknown: false,
      baseId: '1004' as unknown as baseSkillId,
      priority: 0,
      target: AttackTargetOpinion.opponent,
      multihit: 1,
      sureHit: false,
      tag: [],
    },
    {
      id: 'skill5' as unknown as skillId,
      element: Element.Fire,
      category: Category.Climax,
      power: 40,
      rage: 10,
      accuracy: 100,
      isUnknown: false,
      baseId: '1005' as unknown as baseSkillId,
      priority: 0,
      target: AttackTargetOpinion.opponent,
      multihit: 1,
      sureHit: false,
      tag: [],
    },
  ],
}

export const Default: Story = {
  args: {
    ...defaultArgs,
    leftPlayer: {
      ...basePlayer('left'),
      activePet: {
        ...basePet(Element.Fire),
        marks: [
          {
            id: 'mark1' as unknown as markId,
            baseId: '1001' as unknown as baseMarkId,
            stack: 1,
            duration: 3,
            isActive: true,
          },
        ],
      },
      team: Array(3).fill({
        ...basePet(Element.Fire),
        marks: [
          {
            id: 'mark1' as unknown as markId,
            baseId: '1001' as unknown as baseMarkId,
            stack: 1,
            duration: 3,
            isActive: true,
          },
        ],
      }),
    },
    rightPlayer: {
      ...basePlayer('right'),
      activePet: basePet(Element.Water),
    },
  },
}

export const DamageMessages: Story = {
  args: {
    ...defaultArgs,
    leftPlayer: {
      ...basePlayer('left'),
      activePet: basePet(Element.Fire),
    },
    rightPlayer: {
      ...basePlayer('right'),
      activePet: basePet(Element.Water),
    },
    skills: [],
  },
  render: args => ({
    components: { BattleView },
    setup() {
      const battleView = ref<ComponentPublicInstance>()

      const showMessage = (type: string, side: 'left' | 'right', value?: number) => {
        const methods = {
          damage: () => (battleView.value as any)?.showDamageMessage(side, value!, 'normal', false),
          critical: () => (battleView.value as any)?.showDamageMessage(side, 80, 'up', true),
          miss: () => (battleView.value as any)?.showMissMessage(side),
          absorb: () => (battleView.value as any)?.showAbsorbMessage(side),
        }
        return methods[type as keyof typeof methods]?.()
      }

      return { args, showMessage, battleView }
    },
    template: `
      <div class="relative">
        <BattleView
          ref="battleView"
          v-bind="args"
        />
        <div class="fixed bottom-4 left-4 flex gap-2">
          <button
            v-for="(btn, index) in [
              { type: 'damage', label: '左侧普通伤害', side: 'left', value: 50 },
              { type: 'critical', label: '左侧暴击强效', side: 'left' },
              { type: 'miss', label: '左侧Miss', side: 'left' },
              { type: 'absorb', label: '左侧吸收', side: 'left' },
              { type: 'damage', label: '右侧普通伤害', side: 'right', value: 40 },
              { type: 'miss', label: '右侧Miss', side: 'right' },
              { type: 'absorb', label: '右侧吸收', side: 'right' }
            ]"
            :key="index"
            class="px-4 py-2 text-white rounded transition-all hover:scale-105"
            :class="{
              'bg-blue-500': btn.type === 'damage',
              'bg-red-500': btn.type === 'critical',
              'bg-gray-500': ['miss', 'absorb'].includes(btn.type)
            }"
            @click="showMessage(btn.type, btn.side, btn.value)"
          >
            {{ btn.label }}
          </button>
        </div>
      </div>
    `,
  }),
}
