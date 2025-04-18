// battlePage.stories.ts
import type { Meta, StoryObj } from '@storybook/vue3'
import BattlePage from './battlePage.vue'
import {
  Element,
  Category,
  type BattleMessage,
  BattleMessageType,
  type baseSkillId,
  type petId,
  type skillId,
} from '@arcadia-eternity/const'
import { createTestingPinia } from '@pinia/testing'
import { useBattleStore } from '@/stores/battle'
import { ref, type ComponentPublicInstance } from 'vue'
import { nextTick } from 'vue'

// 基础数据定义（与battleView.stories.ts相同）
const basePlayer = (side: 'left' | 'right') => ({
  id: `player${side}`,
  name: `玩家${side === 'left' ? 1 : 2}`,
  rage: side === 'left' ? 50 : 30,
  teamAlives: 3,
  team: Array(3).fill(basePet(Element.Fire)),
  activePet: basePet(Element.Fire),
})

const basePet = (element: Element) => ({
  id: 'pet1',
  level: 50,
  name: element === Element.Fire ? '休罗斯' : '迪兰特',
  speciesID: 'pet_dilante',
  currentHp: element === Element.Fire ? 120 : 110,
  maxHp: element === Element.Fire ? 150 : 130,
  element,
  isUnknown: false,
  marks: [],
  skills: [],
})

const meta: Meta<typeof BattlePage> = {
  title: 'Pages/BattlePage',
  component: BattlePage,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
}

export default meta

type Story = StoryObj<typeof meta>

const setupStore = (options?: { players?: any[]; skills?: any[]; marks?: any[]; availableActions?: any[] }) => {
  const store = useBattleStore()

  // 通过mock state设置数据
  store.battleState = {
    players: options?.players || [basePlayer('left'), basePlayer('right')],
    marks: options?.marks || [],
    currentTurn: 1,
    // 直接在state中设置技能数据
    skills:
      options?.skills?.map(s => ({
        ...s,
        id: s.id,
        baseId: s.baseId,
        category: s.category,
      })) || [],
  } as any

  store.availableActions = options?.availableActions || []
  store.playerId = 'playerleft'

  return { store }
}

// 实现Default Story
export const Default: Story = {
  render: () => ({
    components: { BattlePage },
    setup() {
      setupStore({
        skills: [
          {
            id: 'skill2',
            baseId: '1002',
            element: Element.Normal,
            category: Category.Physical,
            power: 40,
            rage: 10,
            accuracy: 100,
          },
        ],
        availableActions: [{ type: 'use-skill', skill: 'skill2' }],
      })
      return {}
    },
    template: '<BattlePage />',
  }),
}

// 实现SkillAnimations Story
export const SkillAnimations: Story = {
  render: () => ({
    components: { BattlePage },
    setup() {
      const { store } = setupStore({
        players: [basePlayer('left'), basePlayer('right')],
        skills: [
          {
            id: 'skill_demo',
            baseId: '1005',
            category: Category.Climax,
            element: Element.Fire,
          },
        ],
      })

      // 添加本地类型声明解决TS错误
      interface BattlePageExposed {
        useSkillAnimate: (messages: BattleMessage[]) => Promise<void>
      }

      const battlePageRef = ref<ComponentPublicInstance<BattlePageExposed>>()
      const skillType = ref<Category>(Category.Physical)
      const damageValue = ref(50)
      const isCritical = ref(false)
      const effectiveness = ref<'up' | 'normal' | 'down'>('normal')
      const targetSide = ref<'left' | 'right'>('right')

      const triggerAnimation = async () => {
        await nextTick()
        await battlePageRef.value?.useSkillAnimate([
          {
            type: BattleMessageType.SkillUse,
            data: {
              user: 'playerleft' as petId,
              skill: 'skill_demo' as skillId,
              baseSkill: '1005' as baseSkillId,
              target: 'playerright' as petId,
              effects: [],
            },
          },
          {
            type: BattleMessageType.Damage,
            data: {
              target: 'playerright' as petId,
              damage: damageValue.value,
              effectiveness: effectiveness.value,
              isCrit: isCritical.value,
            },
          },
        ])
      }

      return {
        battlePageRef,
        skillType,
        damageValue,
        isCritical,
        effectiveness,
        targetSide,
        triggerAnimation,
      }
    },
    template: `
      <div class="relative">
        <BattlePage ref="battlePageRef" />
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

// 实现DamageMessages Story
export const DamageMessages: Story = {
  render: () => ({
    components: { BattlePage },
    setup() {
      const { store } = setupStore()
      const battlePageRef = ref<ComponentPublicInstance>()

      const showMessage = (type: string, side: 'left' | 'right', value?: number) => {
        const instance = battlePageRef.value?.$ as any
        const methods = {
          damage: () => instance.exposed.showDamageMessage(side, value!, 'normal', false),
          critical: () => instance.exposed.showDamageMessage(side, 80, 'up', true),
          miss: () => instance.exposed.showMissMessage(side),
          absorb: () => instance.exposed.showAbsorbMessage(side),
        }
        return methods[type as keyof typeof methods]?.()
      }

      return { showMessage, battlePageRef }
    },
    template: `
      <div class="relative">
        <BattlePage ref="battlePageRef" />
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

// 实现SkillMessages Story
export const SkillMessages: Story = {
  render: () => ({
    components: { BattlePage },
    setup() {
      const { store } = setupStore({
        skills: [
          { id: 'skill2', baseId: '1002', category: Category.Physical },
          { id: 'skill3', baseId: '1003', category: Category.Status },
        ],
      })

      const battlePageRef = ref<ComponentPublicInstance>()

      const showSkillMessage = (side: 'left' | 'right') => {
        const instance = battlePageRef.value?.$ as any
        const skillId = side === 'left' ? 'skill2' : 'skill3'
        instance.exposed.showUseSkillMessage(side, skillId)
      }

      return { showSkillMessage, battlePageRef }
    },
    template: `
      <div class="relative">
        <BattlePage ref="battlePageRef" />
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
