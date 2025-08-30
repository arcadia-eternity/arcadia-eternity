<template>
  <div>
    <!-- 桌面端图例 -->
    <div class="hidden md:block mb-8 bg-slate-800/40 backdrop-blur-sm border border-slate-700 rounded-lg p-4 sm:p-6">
      <h2 class="text-lg sm:text-xl font-bold text-white mb-4">
        {{ i18next.t('dex.typeChartDetail.legend', { ns: 'webui' }) }}
      </h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
        <div class="flex items-center space-x-2">
          <div class="w-5 h-5 sm:w-6 sm:h-6 bg-red-500 rounded flex-shrink-0"></div>
          <span class="text-white text-sm"
            >2.0× {{ i18next.t('dex.typeChartDetail.superEffective', { ns: 'webui' }) }}</span
          >
        </div>
        <div class="flex items-center space-x-2">
          <div class="w-5 h-5 sm:w-6 sm:h-6 bg-orange-500 rounded flex-shrink-0"></div>
          <span class="text-white text-sm"
            >1.25× {{ i18next.t('dex.typeChartDetail.effective', { ns: 'webui' }) }}</span
          >
        </div>
        <div class="flex items-center space-x-2">
          <div class="w-5 h-5 sm:w-6 sm:h-6 bg-gray-500 rounded flex-shrink-0"></div>
          <span class="text-white text-sm">1.0× {{ i18next.t('dex.typeChartDetail.effective', { ns: 'webui' }) }}</span>
        </div>
        <div class="flex items-center space-x-2">
          <div class="w-5 h-5 sm:w-6 sm:h-6 bg-blue-500 rounded flex-shrink-0"></div>
          <span class="text-white text-sm"
            >0.75× {{ i18next.t('dex.typeChartDetail.notVeryEffective', { ns: 'webui' }) }}</span
          >
        </div>
        <div class="flex items-center space-x-2">
          <div class="w-5 h-5 sm:w-6 sm:h-6 bg-green-500 rounded flex-shrink-0"></div>
          <span class="text-white text-sm"
            >0.5× {{ i18next.t('dex.typeChartDetail.notVeryEffective', { ns: 'webui' }) }}</span
          >
        </div>
        <div class="flex items-center space-x-2">
          <div class="w-5 h-5 sm:w-6 sm:h-6 bg-black rounded border border-gray-600 flex-shrink-0"></div>
          <span class="text-white text-sm">0× {{ i18next.t('dex.typeChartDetail.noEffect', { ns: 'webui' }) }}</span>
        </div>
      </div>
    </div>

    <!-- 移动端交互式视图 -->
    <div class="block md:hidden h-full">
      <div class="flex flex-row gap-3 h-full">
        <!-- 左侧竖长条属性选择器 -->
        <div
          class="w-16 flex-shrink-0 bg-slate-800/40 backdrop-blur-sm border border-slate-700 rounded-lg p-2 flex flex-col"
        >
          <!-- 模式切换 -->
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs text-white font-medium">{{ viewMode === 'attack' ? '攻击' : '防御' }}</span>
            <button
              :class="[
                'relative inline-flex h-4 w-7 items-center rounded-full transition-all duration-200 text-xs',
                viewMode === 'attack' ? 'bg-blue-500' : 'bg-green-500',
              ]"
              @click="viewMode = viewMode === 'attack' ? 'defense' : 'attack'"
            >
              <span
                :class="[
                  'inline-block h-2 w-2 transform rounded-full bg-white transition-all duration-200',
                  viewMode === 'attack' ? 'translate-x-0.5' : 'translate-x-3.5',
                ]"
              />
            </button>
          </div>

          <!-- 竖长条属性列表 -->
          <div class="space-y-1 flex-1 overflow-y-auto">
            <button
              v-for="element in elements"
              :key="`selector-${element}`"
              :class="[
                'flex items-center justify-center w-full p-1 rounded transition-all',
                selectedElement === element
                  ? viewMode === 'attack'
                    ? 'bg-blue-500'
                    : 'bg-green-500'
                  : 'bg-slate-700/30 hover:bg-slate-600/30',
              ]"
              @click="selectedElement = element"
            >
              <ElementIcon :element="element" class="w-6 h-6" />
            </button>
          </div>

          <!-- 简化图例 -->
          <div class="mt-3 pt-3 border-t border-slate-600 flex-shrink-0">
            <div class="grid grid-cols-2 gap-1 text-xs">
              <div class="flex items-center space-x-1">
                <div class="w-2 h-2 bg-red-500 rounded"></div>
                <span class="text-white">2×</span>
              </div>
              <div class="flex items-center space-x-1">
                <div class="w-2 h-2 bg-orange-500 rounded"></div>
                <span class="text-white">1¼×</span>
              </div>
              <div class="flex items-center space-x-1">
                <div class="w-2 h-2 bg-gray-500 rounded"></div>
                <span class="text-white">1×</span>
              </div>
              <div class="flex items-center space-x-1">
                <div class="w-2 h-2 bg-blue-500 rounded"></div>
                <span class="text-white">¾×</span>
              </div>
              <div class="flex items-center space-x-1">
                <div class="w-2 h-2 bg-green-500 rounded"></div>
                <span class="text-white">½×</span>
              </div>
              <div class="flex items-center space-x-1">
                <div class="w-2 h-2 bg-black rounded border border-gray-600"></div>
                <span class="text-white">0×</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 右侧效果展示 -->
        <div
          class="flex-1 min-w-0 bg-slate-800/40 backdrop-blur-sm border border-slate-700 rounded-lg p-2 flex items-center justify-center"
        >
          <div class="grid grid-cols-5 gap-1 w-full max-w-xs">
            <div
              v-for="targetElement in elements"
              :key="`result-${selectedElement}-${targetElement}`"
              :class="[
                'flex flex-col items-center justify-center p-2 rounded cursor-pointer transition-all hover:scale-105 aspect-square',
                viewMode === 'attack'
                  ? getEffectivenessColor(selectedElement, targetElement)
                  : getEffectivenessColor(targetElement, selectedElement),
              ]"
              @click="
                viewMode === 'attack'
                  ? showEffectivenessDetail(selectedElement, targetElement)
                  : showEffectivenessDetail(targetElement, selectedElement)
              "
            >
              <ElementIcon :element="targetElement" class="w-6 h-6 mb-1" />
              <span class="text-white font-bold text-xs">
                {{
                  viewMode === 'attack'
                    ? formatEffectiveness(getEffectiveness(selectedElement, targetElement))
                    : formatEffectiveness(getEffectiveness(targetElement, selectedElement))
                }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 桌面端完整表格 -->
    <div
      class="hidden md:block bg-slate-800/40 backdrop-blur-sm border border-slate-700 rounded-lg p-6 overflow-x-auto"
    >
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

// 移动端视图模式
const viewMode = ref<'attack' | 'defense'>('attack')

// 移动端选中的属性
const selectedElement = ref<Element>(Element.Fire)

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
