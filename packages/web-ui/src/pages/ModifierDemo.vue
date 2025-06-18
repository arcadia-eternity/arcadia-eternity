<script setup lang="ts">
import { ref, computed } from 'vue'
import ModifiedValue from '@/components/battle/ModifiedValue.vue'
import SkillButton from '@/components/battle/SkillButton.vue'
import PetButton from '@/components/battle/PetButton.vue'
import HealthRageBar from '@/components/battle/HealthRageBar.vue'
import type { AttributeModifierInfo, SkillMessage, PetMessage } from '@arcadia-eternity/const'
import { Element, Category } from '@arcadia-eternity/const'

// 示例 modifier 数据
const buffedAttribute: AttributeModifierInfo = {
  attributeName: 'atk',
  baseValue: 100,
  currentValue: 150,
  isModified: true,
  modifiers: [
    {
      id: 'power-boost',
      type: 'percent',
      value: 50,
      priority: 1,
      sourceType: 'skill',
      sourceId: 'skill-123',
      sourceName: '力量增幅',
    },
  ],
}

const debuffedAttribute: AttributeModifierInfo = {
  attributeName: 'def',
  baseValue: 80,
  currentValue: 60,
  isModified: true,
  modifiers: [
    {
      id: 'armor-break',
      type: 'delta',
      value: -20,
      priority: 0,
      sourceType: 'mark',
      sourceId: 'mark-456',
      sourceName: '破甲',
    },
  ],
}

const clampedAttribute: AttributeModifierInfo = {
  attributeName: 'spe',
  baseValue: 120,
  currentValue: 100,
  isModified: true,
  modifiers: [
    {
      id: 'speed-limit',
      type: 'clampMax',
      value: 100,
      priority: 0,
      sourceType: 'other',
      sourceId: 'field-effect',
      sourceName: '速度限制场地',
    },
  ],
}

const mixedAttribute: AttributeModifierInfo = {
  attributeName: 'spa',
  baseValue: 90,
  currentValue: 105,
  isModified: true,
  modifiers: [
    {
      id: 'magic-boost',
      type: 'percent',
      value: 30,
      priority: 1,
      sourceType: 'skill',
      sourceName: '魔法增幅',
    },
    {
      id: 'magic-drain',
      type: 'delta',
      value: -12,
      priority: 0,
      sourceType: 'mark',
      sourceName: '魔力流失',
    },
  ],
}

// 示例技能数据
const exampleSkill: SkillMessage = {
  id: 'skill-demo',
  baseId: '1001',
  element: Element.Fire,
  category: Category.Physical,
  power: 80,
  rage: 15,
  accuracy: 95,
  isUnknown: false,
}

// 示例宠物数据
const examplePet: PetMessage = {
  id: 'pet-demo',
  name: '示例宠物',
  speciesID: 'species-001' as any,
  element: Element.Fire,
  level: 50,
  currentHp: 280,
  maxHp: 300,
  isUnknown: false,
  marks: [],
  modifierState: {
    hasModifiers: true,
    attributes: [
      buffedAttribute,
      debuffedAttribute,
      clampedAttribute,
      mixedAttribute,
      {
        attributeName: 'level',
        baseValue: 50,
        currentValue: 52,
        isModified: true,
        modifiers: [
          {
            id: 'level-boost',
            type: 'delta',
            value: 2,
            priority: 0,
            sourceType: 'other',
            sourceName: '等级提升',
          },
        ],
      },
    ],
  },
}

const demoType = ref<'values' | 'components'>('values')
</script>

<template>
  <div class="min-h-screen bg-gray-900 text-white p-8">
    <div class="max-w-6xl mx-auto">
      <h1 class="text-3xl font-bold mb-8 text-center">Modifier 视觉效果演示</h1>

      <!-- 切换按钮 -->
      <div class="flex justify-center mb-8">
        <div class="bg-gray-800 rounded-lg p-1 flex">
          <button
            @click="demoType = 'values'"
            :class="[
              'px-4 py-2 rounded-md transition-all',
              demoType === 'values' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white',
            ]"
          >
            数值演示
          </button>
          <button
            @click="demoType = 'components'"
            :class="[
              'px-4 py-2 rounded-md transition-all',
              demoType === 'components' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white',
            ]"
          >
            组件演示
          </button>
        </div>
      </div>

      <!-- 数值演示 -->
      <div v-if="demoType === 'values'" class="space-y-8">
        <div class="bg-gray-800 rounded-lg p-6">
          <h2 class="text-xl font-semibold mb-4">ModifiedValue 组件效果</h2>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div class="text-center">
              <h3 class="text-sm text-gray-400 mb-2">普通数值</h3>
              <div class="text-2xl">
                <ModifiedValue :value="100" />
              </div>
            </div>

            <div class="text-center">
              <h3 class="text-sm text-gray-400 mb-2">增益效果</h3>
              <div class="text-2xl">
                <ModifiedValue :value="150" :attribute-info="buffedAttribute" />
              </div>
            </div>

            <div class="text-center">
              <h3 class="text-sm text-gray-400 mb-2">减益效果</h3>
              <div class="text-2xl">
                <ModifiedValue :value="60" :attribute-info="debuffedAttribute" />
              </div>
            </div>

            <div class="text-center">
              <h3 class="text-sm text-gray-400 mb-2">限制效果</h3>
              <div class="text-2xl">
                <ModifiedValue :value="100" :attribute-info="clampedAttribute" />
              </div>
            </div>
          </div>

          <div class="mt-6 text-center">
            <h3 class="text-sm text-gray-400 mb-2">混合效果</h3>
            <div class="text-2xl">
              <ModifiedValue :value="105" :attribute-info="mixedAttribute" />
            </div>
          </div>
        </div>

        <div class="bg-gray-800 rounded-lg p-6">
          <h2 class="text-xl font-semibold mb-4">内联显示效果</h2>
          <div class="space-y-2 text-lg">
            <div>攻击力: <ModifiedValue :value="150" :attribute-info="buffedAttribute" inline size="md" /></div>
            <div>防御力: <ModifiedValue :value="60" :attribute-info="debuffedAttribute" inline size="md" /></div>
            <div>速度: <ModifiedValue :value="100" :attribute-info="clampedAttribute" inline size="md" /></div>
            <div>特攻: <ModifiedValue :value="105" :attribute-info="mixedAttribute" inline size="md" /></div>
          </div>
        </div>
      </div>

      <!-- 组件演示 -->
      <div v-if="demoType === 'components'" class="space-y-8">
        <div class="bg-gray-800 rounded-lg p-6">
          <h2 class="text-xl font-semibold mb-4">HealthRageBar 组件</h2>
          <div class="max-w-md mx-auto">
            <HealthRageBar
              :current="280"
              :max="300"
              :rage="75"
              :maxRage="100"
              :current-hp-modifier-info="buffedAttribute"
              :max-hp-modifier-info="clampedAttribute"
              :rage-modifier-info="debuffedAttribute"
            />
          </div>
        </div>

        <div class="bg-gray-800 rounded-lg p-6">
          <h2 class="text-xl font-semibold mb-4">SkillButton 组件</h2>
          <div class="flex justify-center">
            <SkillButton
              :skill="exampleSkill"
              :power-modifier-info="buffedAttribute"
              :accuracy-modifier-info="debuffedAttribute"
              :rage-modifier-info="clampedAttribute"
            />
          </div>
        </div>

        <div class="bg-gray-800 rounded-lg p-6">
          <h2 class="text-xl font-semibold mb-4">PetButton 组件</h2>
          <div class="flex justify-center">
            <PetButton :pet="examplePet" position="bottom" />
          </div>
        </div>
      </div>

      <!-- 说明文档 -->
      <div class="mt-12 bg-gray-800 rounded-lg p-6">
        <h2 class="text-xl font-semibold mb-4">效果说明</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
          <div>
            <h3 class="font-medium text-green-400 mb-2">🟢 增益效果 (Buffed)</h3>
            <p class="text-gray-300">绿色文字，表示属性得到正面提升</p>
          </div>

          <div>
            <h3 class="font-medium text-red-400 mb-2">🔴 减益效果 (Debuffed)</h3>
            <p class="text-gray-300">红色文字，表示属性被负面影响</p>
          </div>

          <div>
            <h3 class="font-medium text-orange-400 mb-2">🟠 限制效果 (Clamped)</h3>
            <p class="text-gray-300">橙色文字，表示属性被限制在特定范围</p>
          </div>

          <div>
            <h3 class="font-medium text-purple-400 mb-2">🟣 混合效果 (Mixed)</h3>
            <p class="text-gray-300">紫色文字，表示同时存在多种修改器</p>
          </div>
        </div>

        <div class="mt-4 p-4 bg-gray-700 rounded">
          <p class="text-sm text-gray-300">
            💡 <strong>提示:</strong> 将鼠标悬停在受影响的数值上可以查看详细的 modifier
            信息，包括来源、类型、优先级等。受影响的组件会显示彩色边框提示。
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 确保动画效果正常显示 */
.animate-pulse {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
</style>
