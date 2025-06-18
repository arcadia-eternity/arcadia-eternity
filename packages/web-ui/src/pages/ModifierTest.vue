<script setup lang="ts">
import { ref, computed } from 'vue'
import { useBattleStore } from '@/stores/battle'
import PetButton from '@/components/battle/PetButton.vue'
import SkillButton from '@/components/battle/SkillButton.vue'
import ModifiedValue from '@/components/battle/ModifiedValue.vue'
import type { PetMessage, SkillMessage, AttributeModifierInfo } from '@arcadia-eternity/const'
import { Element, Category } from '@arcadia-eternity/const'

// 创建测试用的 modifier 数据
const createTestModifierInfo = (
  attributeName: string,
  baseValue: number,
  currentValue: number,
): AttributeModifierInfo => {
  return {
    attributeName,
    baseValue,
    currentValue,
    isModified: true,
    modifiers: [
      {
        id: `test-modifier-${attributeName}`,
        type: 'percent',
        value: 50,
        priority: 1,
        sourceType: 'skill',
        sourceId: 'test-skill',
        sourceName: '测试技能增益',
      },
    ],
  }
}

// 创建测试宠物数据
const createTestPet = (): PetMessage => {
  return {
    id: 'test-pet-1' as any,
    name: '测试宠物',
    speciesID: 'test-species' as any,
    element: Element.Fire,
    level: 50,
    currentHp: 280,
    maxHp: 300,
    isUnknown: false,
    marks: [],
    skills: [
      {
        id: 'test-skill-1' as any,
        baseId: '1001' as any,
        element: Element.Fire,
        category: Category.Physical,
        power: 80,
        rage: 15,
        accuracy: 95,
        priority: 0,
        target: 'enemy' as any,
        multihit: 1,
        sureHit: false,
        tag: [],
        isUnknown: false,
      },
    ],
    modifierState: {
      hasModifiers: true,
      attributes: [
        createTestModifierInfo('level', 50, 52),
        createTestModifierInfo('currentHp', 280, 300),
        createTestModifierInfo('maxHp', 300, 350),
        createTestModifierInfo('skill_test-skill-1_power', 80, 120),
        createTestModifierInfo('skill_test-skill-1_accuracy', 95, 100),
        createTestModifierInfo('skill_test-skill-1_rage', 15, 12),
      ],
    },
  }
}

// 创建测试技能数据
const createTestSkill = (): SkillMessage => {
  return {
    id: 'test-skill-1' as any,
    baseId: '1001' as any,
    element: Element.Fire,
    category: Category.Physical,
    power: 80,
    rage: 15,
    accuracy: 95,
    priority: 0,
    target: 'enemy' as any,
    multihit: 1,
    sureHit: false,
    tag: [],
    isUnknown: false,
    modifierState: {
      hasModifiers: true,
      attributes: [
        createTestModifierInfo('power', 80, 120), // 威力提升：正面效果
        createTestModifierInfo('accuracy', 95, 100), // 命中率提升：正面效果
        createTestModifierInfo('rage', 15, 18), // 怒气消耗增加：负面效果
      ],
    },
  }
}

const testPet = ref(createTestPet())
const testSkill = ref(createTestSkill())

// 获取技能的 modifier 信息
const getTestSkillModifierInfo = (attributeName: string) => {
  return testSkill.value.modifierState?.attributes.find(attr => attr.attributeName === attributeName)
}

const store = useBattleStore()

// 模拟设置 battle store 数据
const setupTestData = () => {
  store.battleState = {
    status: 'OnBattle' as any,
    currentPhase: 'ExecutionPhase' as any,
    currentTurn: 1,
    marks: [],
    players: [
      {
        id: 'test-player' as any,
        name: '测试玩家',
        rage: 50,
        maxRage: 100,
        activePet: testPet.value.id,
        team: [testPet.value],
        teamAlives: 1,
        modifierState: {
          hasModifiers: true,
          attributes: [createTestModifierInfo('rage', 50, 60), createTestModifierInfo('maxRage', 100, 120)],
        },
      },
    ],
  }

  store.playerId = 'test-player'
}

// 初始化测试数据
setupTestData()

const showRawData = ref(false)
</script>

<template>
  <div class="min-h-screen bg-gray-900 text-white p-8">
    <div class="max-w-4xl mx-auto">
      <h1 class="text-3xl font-bold mb-8 text-center">Modifier 效果测试页面</h1>

      <!-- 控制面板 -->
      <div class="bg-gray-800 rounded-lg p-6 mb-8">
        <div class="flex items-center gap-4">
          <button @click="setupTestData" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">
            重新加载测试数据
          </button>

          <button
            @click="showRawData = !showRawData"
            class="px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded-lg transition-colors"
          >
            {{ showRawData ? '隐藏' : '显示' }}原始数据
          </button>
        </div>
      </div>

      <!-- 原始数据显示 -->
      <div v-if="showRawData" class="bg-gray-800 rounded-lg p-6 mb-8">
        <h2 class="text-xl font-semibold mb-4">原始数据</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h3 class="text-lg font-medium mb-2">Pet ModifierState</h3>
            <pre class="text-xs bg-gray-900 p-3 rounded overflow-auto max-h-60">{{
              JSON.stringify(testPet.modifierState, null, 2)
            }}</pre>
          </div>
          <div>
            <h3 class="text-lg font-medium mb-2">Battle Store State</h3>
            <pre class="text-xs bg-gray-900 p-3 rounded overflow-auto max-h-60">{{
              JSON.stringify(store.battleState?.players[0]?.modifierState, null, 2)
            }}</pre>
          </div>
        </div>
      </div>

      <!-- ModifiedValue 组件测试 -->
      <div class="bg-gray-800 rounded-lg p-6 mb-8">
        <h2 class="text-xl font-semibold mb-4">ModifiedValue 组件测试</h2>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div class="text-center">
            <h3 class="text-sm text-gray-400 mb-2">等级</h3>
            <div class="text-2xl">
              <ModifiedValue
                :value="testPet.level"
                :attribute-info="testPet.modifierState?.attributes.find(attr => attr.attributeName === 'level')"
              />
            </div>
          </div>

          <div class="text-center">
            <h3 class="text-sm text-gray-400 mb-2">当前HP</h3>
            <div class="text-2xl">
              <ModifiedValue
                :value="testPet.currentHp"
                :attribute-info="testPet.modifierState?.attributes.find(attr => attr.attributeName === 'currentHp')"
              />
            </div>
          </div>

          <div class="text-center">
            <h3 class="text-sm text-gray-400 mb-2">最大HP</h3>
            <div class="text-2xl">
              <ModifiedValue
                :value="testPet.maxHp"
                :attribute-info="testPet.modifierState?.attributes.find(attr => attr.attributeName === 'maxHp')"
              />
            </div>
          </div>

          <div class="text-center">
            <h3 class="text-sm text-gray-400 mb-2">技能威力</h3>
            <div class="text-2xl">
              <ModifiedValue :value="testSkill.power" :attribute-info="getTestSkillModifierInfo('power')" />
            </div>
          </div>
        </div>

        <!-- 怒气消耗策略测试 -->
        <div class="mt-8 border-t border-gray-600 pt-6">
          <h3 class="text-lg font-medium mb-4">怒气消耗策略测试</h3>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div class="text-center bg-gray-700 rounded-lg p-4">
              <h4 class="text-sm text-gray-400 mb-2">怒气消耗增加</h4>
              <div class="text-xl mb-2">
                <ModifiedValue :value="18" :attribute-info="createTestModifierInfo('rage', 15, 18)" />
              </div>
              <p class="text-xs text-gray-500">15 → 18 (红色，负面)</p>
            </div>

            <div class="text-center bg-gray-700 rounded-lg p-4">
              <h4 class="text-sm text-gray-400 mb-2">怒气消耗减少</h4>
              <div class="text-xl mb-2">
                <ModifiedValue :value="12" :attribute-info="createTestModifierInfo('rage', 15, 12)" />
              </div>
              <p class="text-xs text-gray-500">15 → 12 (绿色，正面)</p>
            </div>

            <div class="text-center bg-gray-700 rounded-lg p-4">
              <h4 class="text-sm text-gray-400 mb-2">威力提升对比</h4>
              <div class="text-xl mb-2">
                <ModifiedValue :value="120" :attribute-info="createTestModifierInfo('power', 80, 120)" />
              </div>
              <p class="text-xs text-gray-500">80 → 120 (绿色，正面)</p>
            </div>
          </div>
        </div>
      </div>

      <!-- SkillButton 组件测试 -->
      <div class="bg-gray-800 rounded-lg p-6 mb-8">
        <h2 class="text-xl font-semibold mb-4">SkillButton 组件测试</h2>
        <div class="text-sm text-gray-400 mb-4">
          测试技能按钮的 modifier 效果。技能属性受到影响时，数值应该显示对应的颜色，但按钮本身不应该有额外的边框效果。
        </div>
        <div class="flex justify-center">
          <SkillButton
            :skill="testSkill"
            :power-modifier-info="getTestSkillModifierInfo('power')"
            :accuracy-modifier-info="getTestSkillModifierInfo('accuracy')"
            :rage-modifier-info="getTestSkillModifierInfo('rage')"
          />
        </div>
        <div class="mt-4 text-xs text-gray-500 text-center">
          预期效果：技能威力显示绿色（增益），命中率显示绿色（增益），怒气消耗显示红色（消耗增加，负面效果）
        </div>
      </div>

      <!-- PetButton 组件测试 -->
      <div class="bg-gray-800 rounded-lg p-6 mb-8">
        <h2 class="text-xl font-semibold mb-4">PetButton 组件测试</h2>
        <div class="flex justify-center">
          <PetButton :pet="testPet" position="bottom" />
        </div>
      </div>

      <!-- 调试信息 -->
      <div class="bg-gray-800 rounded-lg p-6">
        <h2 class="text-xl font-semibold mb-4">调试信息</h2>
        <div class="text-sm space-y-2">
          <div>Pet hasModifiers: {{ testPet.modifierState?.hasModifiers }}</div>
          <div>Modifier attributes count: {{ testPet.modifierState?.attributes.length }}</div>
          <div>Store playerId: {{ store.playerId }}</div>
          <div>Store battleState exists: {{ !!store.battleState }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
pre {
  font-family: 'Courier New', monospace;
}
</style>
