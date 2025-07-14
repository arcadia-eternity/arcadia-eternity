<script setup lang="ts">
import { computed } from 'vue'
import { useResourceStore } from '@/stores/resource'
import { useGameDataStore } from '@/stores/gameData'
import type { SkillMarkRelation } from '@/services/skillMarkRelationService'
import i18next from 'i18next'
import { ShieldCheckIcon } from '@heroicons/vue/24/outline'

interface Props {
  markId: string
  relation: SkillMarkRelation
  compact?: boolean
  showDescription?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  compact: true,
  showDescription: false,
})

const resourceStore = useResourceStore()
const gameDataStore = useGameDataStore()

// 获取印记数据
const mark = computed(() => {
  return gameDataStore.marks.byId[props.markId]
})

// 获取印记名称
const markName = computed(() => {
  try {
    return (
      i18next.t(`${props.markId}.name`, {
        ns: ['mark', 'mark_ability', 'mark_emblem', 'mark_global'],
      }) || props.markId
    )
  } catch {
    return props.markId
  }
})

// 获取印记描述
const markDescription = computed(() => {
  if (!props.showDescription) return ''
  try {
    return (
      i18next.t(`${props.markId}.description`, {
        ns: ['mark', 'mark_ability', 'mark_emblem', 'mark_global'],
      }) || ''
    )
  } catch {
    return ''
  }
})

// 获取印记图片
const markImage = computed(() => {
  try {
    return resourceStore.markImage.byId[props.markId] || null
  } catch {
    return null
  }
})

// 获取关联类型的显示文本
const getRelationTypeText = (relationType: SkillMarkRelation['relationType']): string => {
  const typeMap = {
    adds: '添加',
    removes: '移除',
    modifies: '修改',
    consumes: '消耗',
    tags: '相关',
  }
  return typeMap[relationType] || relationType
}

// 获取关联类型的样式
const getRelationTypeClass = (relationType: SkillMarkRelation['relationType']): string => {
  const classMap = {
    adds: 'bg-green-600/20 border-green-500/50 text-green-300',
    removes: 'bg-red-600/20 border-red-500/50 text-red-300',
    modifies: 'bg-blue-600/20 border-blue-500/50 text-blue-300',
    consumes: 'bg-orange-600/20 border-orange-500/50 text-orange-300',
    tags: 'bg-purple-600/20 border-purple-500/50 text-purple-300',
  }
  return classMap[relationType] || 'bg-gray-600/20 border-gray-500/50 text-gray-300'
}
</script>

<template>
  <div class="text-sm" :class="showDescription ? 'space-y-2' : ''">
    <!-- 印记头部信息 -->
    <div class="flex items-center gap-2">
      <!-- 印记图标 -->
      <div class="flex-shrink-0 w-6 h-6 bg-slate-600/50 rounded flex items-center justify-center overflow-hidden">
        <img v-if="markImage" :src="markImage" :alt="markName" class="w-full h-full object-contain" />
        <ShieldCheckIcon v-else class="w-4 h-4 text-purple-400" />
      </div>

      <!-- 印记信息 -->
      <div class="flex items-center gap-2 flex-1 min-w-0">
        <span class="text-white truncate">{{ markName }}</span>
        <span
          class="text-xs px-1.5 py-0.5 rounded border flex-shrink-0"
          :class="getRelationTypeClass(relation.relationType)"
        >
          {{ getRelationTypeText(relation.relationType) }}
        </span>
      </div>
    </div>

    <!-- 印记描述 -->
    <div v-if="showDescription && markDescription" class="text-xs text-gray-300 leading-relaxed pl-8">
      {{ markDescription }}
    </div>
  </div>
</template>
