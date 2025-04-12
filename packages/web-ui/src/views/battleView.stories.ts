import type { Meta, StoryObj } from '@storybook/vue3'
import BattleView from './battle.vue'
import { Element, Category, AttackTargetOpinion } from '@test-battle/const'
import type { markId, speciesId, baseMarkId, baseSkillId, petId, skillId, playerId } from '@test-battle/const'
import { ref, useTemplateRef, type ComponentPublicInstance } from 'vue'

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
  name: element === Element.Fire ? '休罗斯' : '迪兰特',
  speciesID: 'pet_dilante' as unknown as speciesId,
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
  parameters: {
    layout: 'fullscreen', // 关键参数
  },
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

export const SkillAnimations: Story = {
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
  },
  render: args => ({
    components: { BattleView },
    setup() {
      const battleView = useTemplateRef('battleView')
      const skillType = ref<Category>(Category.Physical)
      const damageValue = ref(50)
      const isCritical = ref(false)
      const effectiveness = ref<'up' | 'normal' | 'down'>('normal')
      const targetSide = ref<'left' | 'right'>('right')

      const triggerAnimation = async () => {
        try {
          await (battleView.value as any)?.useSkillAnimate(
            'skill_demo',
            skillType.value,
            [
              {
                type: 'damage',
                targetSide: targetSide.value,
                value: damageValue.value,
                effectiveness: effectiveness.value,
                crit: isCritical.value,
              },
            ],
            'left',
          )
        } catch (err) {
          console.error('动画错误:', err)
        }
      }

      const triggerErrorState = async () => {
        try {
          // 故意传入无效的state参数
          await (battleView.value as any)?.useSkillAnimate(
            'invalid_skill',
            Category.Physical,
            [],
            'left',
            'INVALID_STATE' as any,
          )
        } catch (err) {
          alert(`错误捕获: ${err instanceof Error ? err.message : '未知错误类型'}`)
        }
      }

      return {
        args,
        battleView,
        skillType,
        damageValue,
        isCritical,
        effectiveness,
        targetSide,
        triggerAnimation,
        triggerErrorState,
      }
    },
    template: `
      <div class="relative">
        <BattleView
          ref="battleView"
          v-bind="args"
        />
        <div class="fixed bottom-4 left-4 flex flex-col gap-2 p-4 bg-gray-800/80 rounded-lg">
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-2">
              <label class="text-white">技能类型:</label>
              <select v-model="skillType" class="p-2 rounded">
                <option value="Physical">物理攻击</option>
                <option value="Special">特殊攻击</option>
                <option value="Status">状态技能</option>
                <option value="Climax">必杀技</option>
              </select>
            </div>

            <div class="space-y-2">
              <label class="text-white">目标方向:</label>
              <select v-model="targetSide" class="p-2 rounded">
                <option value="left">左侧</option>
                <option value="right">右侧</option>
              </select>
            </div>

            <div class="space-y-2">
              <label class="text-white">伤害值:</label>
              <input type="number" v-model.number="damageValue" class="p-2 rounded w-full">
            </div>

            <div class="space-y-2">
              <label class="text-white">效果强度:</label>
              <select v-model="effectiveness" class="p-2 rounded">
                <option value="up">强效</option>
                <option value="normal">普通</option>
                <option value="down">弱效</option>
              </select>
            </div>

            <div class="flex items-center gap-2">
              <input type="checkbox" v-model="isCritical" id="criticalCheck">
              <label for="criticalCheck" class="text-white">暴击</label>
            </div>
          </div>

          <div class="flex gap-2">
            <button
              @click="triggerAnimation"
              class="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
            >
              触发技能动画
            </button>
            <button
              @click="triggerErrorState"
              class="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
            >
              测试错误状态
            </button>
          </div>
        </div>
      </div>
    `,
  }),
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

export const SkillMessages: Story = {
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

      const showSkillMessage = (side: 'left' | 'right') => {
        const skillId = side === 'left' ? 'skill2' : 'skill3'
        ;(battleView.value as any)?.showUseSkillMessage(side, skillId as unknown as skillId)
      }

      return { args, showSkillMessage, battleView }
    },
    template: `
      <div class="relative">
        <BattleView
          ref="battleView"
          v-bind="args"
        />
        <div class="fixed bottom-4 left-4 flex gap-2">
          <button
            class="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600"
            @click="showSkillMessage('left')"
          >
            左侧技能消息
          </button>
          <button
            class="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600"
            @click="showSkillMessage('right')"
          >
            右侧技能消息
          </button>
        </div>
      </div>
    `,
  }),
}
