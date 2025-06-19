<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import type { AttributeModifierInfo } from '@arcadia-eternity/const'
import Tooltip from './Tooltip.vue'
import i18next from 'i18next'
import { analyzeModifierType, getModifierClasses, formatModifierValue, getModifierIcon } from '@/utils/modifierStyles'

interface Props {
  value: number | string
  attributeInfo?: AttributeModifierInfo
  showTooltip?: boolean
  size?: 'sm' | 'md' | 'lg'
  inline?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  showTooltip: false,
  size: 'md',
  inline: false,
})

// 判断是否受到 modifier 影响
const isModified = computed(() => {
  return props.attributeInfo?.isModified ?? false
})

// 计算 modifier 效果类型
const modifierType = computed(() => {
  return analyzeModifierType(props.attributeInfo)
})

// 样式类
const valueClasses = computed(() => {
  return getModifierClasses(modifierType.value, props.size, props.inline)
})

// Tooltip 内容
const tooltipContent = computed(() => {
  if (!props.attributeInfo || !isModified.value) return ''

  const lines: string[] = []

  // 基础值和当前值
  lines.push(`${i18next.t('modifier.baseValue', { ns: 'webui' }) || '基础值'}: ${props.attributeInfo.baseValue}`)
  lines.push(`${i18next.t('modifier.currentValue', { ns: 'webui' }) || '当前值'}: ${props.attributeInfo.currentValue}`)

  if (props.attributeInfo.modifiers.length > 0) {
    lines.push('')
    lines.push(`${i18next.t('modifier.activeModifiers', { ns: 'webui' }) || '生效的修改器'}:`)

    props.attributeInfo.modifiers.forEach((modifier, index) => {
      const icon = getModifierIcon(modifier.type)
      const formattedValue = formatModifierValue(modifier)

      lines.push(`${index + 1}. ${icon} ${modifier.id}`)
      lines.push(`   ${i18next.t('modifier.type', { ns: 'webui' }) || '类型'}: ${modifier.type}`)
      lines.push(`   ${i18next.t('modifier.value', { ns: 'webui' }) || '值'}: ${formattedValue}`)
      lines.push(`   ${i18next.t('modifier.priority', { ns: 'webui' }) || '优先级'}: ${modifier.priority}`)

      if (modifier.sourceName || modifier.sourceId) {
        const sourceText = modifier.sourceName || `${modifier.sourceType} (${modifier.sourceId})`
        lines.push(`   ${i18next.t('modifier.source', { ns: 'webui' }) || '来源'}: ${sourceText}`)
      }
    })
  }

  return lines.join('\n')
})

// 简化的引用，不需要动画
const elementRef = useTemplateRef('elementRef')
</script>

<template>
  <div :class="props.inline ? 'inline-block' : 'block'">
    <Tooltip v-if="showTooltip && isModified && tooltipContent" position="bottom">
      <template #trigger>
        <span ref="elementRef" :class="valueClasses">
          {{ value }}
        </span>
      </template>
      <div class="text-sm max-w-xs bg-gray-900 border border-gray-700 rounded-lg p-3 shadow-lg">
        <div class="font-semibold mb-2 text-white border-b border-gray-600 pb-1">
          {{ i18next.t('modifier.title', { ns: 'webui' }) || '修改器信息' }}
        </div>
        <div class="whitespace-pre-line text-gray-200 leading-relaxed">
          {{ tooltipContent }}
        </div>
        <div v-if="attributeInfo?.modifiers?.length" class="mt-2 pt-2 border-t border-gray-600">
          <div class="text-xs text-gray-400">
            {{ i18next.t('modifier.totalModifiers', { ns: 'webui' }) || '共' }} {{ attributeInfo.modifiers.length }}
            {{ i18next.t('modifier.modifiersCount', { ns: 'webui' }) || '个修改器' }}
          </div>
        </div>
      </div>
    </Tooltip>

    <span v-else ref="elementRef" :class="valueClasses">
      {{ value }}
    </span>
  </div>
</template>
