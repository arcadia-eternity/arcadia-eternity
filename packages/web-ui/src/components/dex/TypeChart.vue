<template>
  <div>
    <!-- 页面标题 -->
    <div class="text-center mb-8">
      <h2 class="text-2xl font-bold text-white mb-2">
        {{ i18next.t('dex.typeChartDetail.title', { ns: 'webui' }) }}
      </h2>
      <p class="text-gray-300">{{ i18next.t('dex.typeChartDetail.description', { ns: 'webui' }) }}</p>
    </div>

    <!-- 图例 -->
    <div class="mb-8 bg-slate-800/40 backdrop-blur-sm border border-slate-700 rounded-lg p-6">
      <h2 class="text-xl font-bold text-white mb-4">{{ i18next.t('dex.typeChartDetail.legend', { ns: 'webui' }) }}</h2>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="flex items-center space-x-2">
          <div class="w-6 h-6 bg-red-500 rounded"></div>
          <span class="text-white">2.0× {{ i18next.t('dex.typeChartDetail.superEffective', { ns: 'webui' }) }}</span>
        </div>
        <div class="flex items-center space-x-2">
          <div class="w-6 h-6 bg-orange-500 rounded"></div>
          <span class="text-white">1.25× {{ i18next.t('dex.typeChartDetail.effective', { ns: 'webui' }) }}</span>
        </div>
        <div class="flex items-center space-x-2">
          <div class="w-6 h-6 bg-gray-500 rounded"></div>
          <span class="text-white">1.0× {{ i18next.t('dex.typeChartDetail.effective', { ns: 'webui' }) }}</span>
        </div>
        <div class="flex items-center space-x-2">
          <div class="w-6 h-6 bg-blue-500 rounded"></div>
          <span class="text-white">0.75× {{ i18next.t('dex.typeChartDetail.notVeryEffective', { ns: 'webui' }) }}</span>
        </div>
        <div class="flex items-center space-x-2">
          <div class="w-6 h-6 bg-green-500 rounded"></div>
          <span class="text-white">0.5× {{ i18next.t('dex.typeChartDetail.notVeryEffective', { ns: 'webui' }) }}</span>
        </div>
        <div class="flex items-center space-x-2">
          <div class="w-6 h-6 bg-black rounded border border-gray-600"></div>
          <span class="text-white">0× {{ i18next.t('dex.typeChartDetail.noEffect', { ns: 'webui' }) }}</span>
        </div>
      </div>
    </div>

    <!-- 属性克制表 -->
    <div class="bg-slate-800/40 backdrop-blur-sm border border-slate-700 rounded-lg p-6 overflow-x-auto">
      <div class="min-w-max">
        <!-- 表头 -->
        <div class="grid grid-cols-24 gap-1 mb-2">
          <!-- 左上角空白 -->
          <div class="col-span-1"></div>
          <!-- 防御属性标题 -->
          <div
            v-for="defendingElement in elements"
            :key="`header-${defendingElement}`"
            class="flex items-center justify-center p-2 bg-slate-700/50 rounded text-xs font-medium text-white"
          >
            <ElementIcon :element="defendingElement" class="w-4 h-4" />
          </div>
        </div>

        <!-- 表格内容 -->
        <div v-for="attackingElement in elements" :key="`row-${attackingElement}`" class="grid grid-cols-24 gap-1 mb-1">
          <!-- 攻击属性标题 -->
          <div class="flex items-center justify-center p-2 bg-slate-700/50 rounded text-xs font-medium text-white">
            <ElementIcon :element="attackingElement" class="w-4 h-4" />
          </div>

          <!-- 效果值 -->
          <div
            v-for="defendingElement in elements"
            :key="`cell-${attackingElement}-${defendingElement}`"
            :class="[
              'flex items-center justify-center p-2 rounded text-xs font-bold text-white cursor-pointer transition-all hover:scale-105',
              getEffectivenessColor(attackingElement, defendingElement),
            ]"
            :title="`${getElementName(attackingElement)} → ${getElementName(defendingElement)}: ${getEffectiveness(attackingElement, defendingElement)}×`"
            @click="showEffectivenessDetail(attackingElement, defendingElement)"
          >
            {{ formatEffectiveness(getEffectiveness(attackingElement, defendingElement)) }}
          </div>
        </div>
      </div>
    </div>

    <!-- 详情弹窗 -->
    <div
      v-if="selectedEffectiveness"
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      @click="selectedEffectiveness = null"
    >
      <div class="bg-slate-800 border border-slate-700 rounded-lg p-6 max-w-md mx-4" @click.stop>
        <h3 class="text-xl font-bold text-white mb-4">
          {{ i18next.t('dex.typeChartDetail.effectiveness', { ns: 'webui' }) }}
        </h3>
        <div class="space-y-3">
          <div class="flex items-center space-x-3">
            <ElementIcon :element="selectedEffectiveness.attacking" class="w-8 h-8" />
            <span class="text-white">{{ getElementName(selectedEffectiveness.attacking) }}</span>
            <span class="text-gray-400">→</span>
            <ElementIcon :element="selectedEffectiveness.defending" class="w-8 h-8" />
            <span class="text-white">{{ getElementName(selectedEffectiveness.defending) }}</span>
          </div>
          <div class="text-center">
            <div
              :class="[
                'inline-block px-4 py-2 rounded-lg text-white font-bold text-lg',
                getEffectivenessColor(selectedEffectiveness.attacking, selectedEffectiveness.defending),
              ]"
            >
              {{ formatEffectiveness(selectedEffectiveness.multiplier) }}×
              {{ i18next.t('dex.typeChartDetail.multiplier', { ns: 'webui' }) }}
            </div>
          </div>
        </div>
        <button
          @click="selectedEffectiveness = null"
          class="mt-4 w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
        >
          关闭
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useTranslation } from 'i18next-vue'
import { Element, ELEMENT_CHART, ELEMENT_MAP } from '@arcadia-eternity/const'
import ElementIcon from '@/components/battle/ElementIcon.vue'

const { i18next } = useTranslation()

// 所有属性列表
const elements = computed(() => Object.values(Element))

// 选中的效果详情
const selectedEffectiveness = ref<{
  attacking: Element
  defending: Element
  multiplier: number
} | null>(null)

// 获取效果值
function getEffectiveness(attacking: Element, defending: Element): number {
  return ELEMENT_CHART[attacking][defending]
}

// 获取效果颜色
function getEffectivenessColor(attacking: Element, defending: Element): string {
  const effectiveness = getEffectiveness(attacking, defending)

  if (effectiveness === 0) return 'bg-black border border-gray-600'
  if (effectiveness === 0.5) return 'bg-green-500'
  if (effectiveness === 0.75) return 'bg-blue-500'
  if (effectiveness === 1) return 'bg-gray-500'
  if (effectiveness === 1.25) return 'bg-orange-500'
  if (effectiveness === 2) return 'bg-red-500'

  return 'bg-gray-500'
}

// 格式化效果值
function formatEffectiveness(value: number): string {
  if (value === 0) return '0'
  if (value === 0.5) return '½'
  if (value === 0.75) return '¾'
  if (value === 1) return '1'
  if (value === 1.25) return '1¼'
  if (value === 2) return '2'
  return value.toString()
}

// 获取属性名称
function getElementName(element: Element): string {
  try {
    return i18next.t(`element.${element}`, { ns: 'battle' }) || ELEMENT_MAP[element]?.name || element
  } catch {
    return ELEMENT_MAP[element]?.name || element
  }
}

// 显示效果详情
function showEffectivenessDetail(attacking: Element, defending: Element) {
  selectedEffectiveness.value = {
    attacking,
    defending,
    multiplier: getEffectiveness(attacking, defending),
  }
}
</script>

<style scoped>
.grid-cols-24 {
  grid-template-columns: repeat(24, minmax(0, 1fr));
}
</style>
