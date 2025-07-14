<script setup lang="ts">
import { computed } from 'vue'
import { useResourceStore } from '@/stores/resource'
import { useGameDataStore } from '@/stores/gameData'
import type { SkillMarkRelation } from '@/services/skillMarkRelationService'
import i18next from 'i18next'
import { ShieldCheckIcon, TagIcon, LinkIcon } from '@heroicons/vue/24/outline'

interface Props {
  markId: string
  relation?: SkillMarkRelation
  compact?: boolean
  showRelationType?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  compact: false,
  showRelationType: true
})

const emit = defineEmits<{
  click: [markId: string]
}>()

const resourceStore = useResourceStore()
const gameDataStore = useGameDataStore()

// 获取印记数据
const mark = computed(() => {
  return gameDataStore.marks.byId[props.markId]
})

// 获取印记名称
const markName = computed(() => {
  try {
    return i18next.t(`${props.markId}.name`, {
      ns: ['mark', 'mark_ability', 'mark_emblem', 'mark_global']
    }) || props.markId
  } catch {
    return props.markId
  }
})

// 获取印记描述
const markDescription = computed(() => {
  try {
    return i18next.t(`${props.markId}.description`, {
      ns: ['mark', 'mark_ability', 'mark_emblem', 'mark_global']
    }) || ''
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
function getRelationTypeText(relationType: SkillMarkRelation['relationType']): string {
  const typeMap = {
    adds: '添加',
    removes: '移除',
    modifies: '修改',
    consumes: '消耗',
    tags: '相关'
  }
  return typeMap[relationType] || relationType
}

// 获取关联类型的样式
function getRelationTypeClass(relationType: SkillMarkRelation['relationType']): string {
  const classMap = {
    adds: 'bg-green-600/20 border-green-500/50 text-green-300',
    removes: 'bg-red-600/20 border-red-500/50 text-red-300',
    modifies: 'bg-blue-600/20 border-blue-500/50 text-blue-300',
    consumes: 'bg-orange-600/20 border-orange-500/50 text-orange-300',
    tags: 'bg-purple-600/20 border-purple-500/50 text-purple-300'
  }
  return classMap[relationType] || 'bg-gray-600/20 border-gray-500/50 text-gray-300'
}

// 获取关联类型的图标
function getRelationTypeIcon(relationType: SkillMarkRelation['relationType']) {
  const iconMap = {
    adds: LinkIcon,
    removes: LinkIcon,
    modifies: LinkIcon,
    consumes: LinkIcon,
    tags: TagIcon
  }
  return iconMap[relationType] || LinkIcon
}

// 处理点击事件
function handleClick() {
  emit('click', props.markId)
}
</script>

<template>
  <div
    class="bg-slate-700/30 rounded-lg p-4 hover:bg-slate-700/50 transition-colors cursor-pointer group"
    :class="{ 'p-3': compact }"
    @click="handleClick"
  >
    <!-- 印记头部 -->
    <div class="flex items-center gap-3 mb-3" :class="{ 'mb-2': compact }">
      <!-- 印记图标 -->
      <div 
        class="flex-shrink-0 bg-slate-600/50 rounded-lg flex items-center justify-center overflow-hidden"
        :class="compact ? 'w-10 h-10' : 'w-12 h-12'"
      >
        <img
          v-if="markImage"
          :src="markImage"
          :alt="markName"
          class="w-full h-full object-contain"
        />
        <ShieldCheckIcon 
          v-else 
          class="text-purple-400"
          :class="compact ? 'w-6 h-6' : 'w-8 h-8'"
        />
      </div>

      <!-- 印记信息 -->
      <div class="flex-1 min-w-0">
        <h3 
          class="font-semibold text-white truncate group-hover:text-blue-300 transition-colors"
          :class="compact ? 'text-sm' : 'text-base'"
        >
          {{ markName }}
        </h3>
        <div 
          class="text-gray-400 truncate"
          :class="compact ? 'text-xs' : 'text-sm'"
        >
          {{ markId }}
        </div>
      </div>
    </div>

    <!-- 印记描述 (非紧凑模式) -->
    <div 
      v-if="!compact && markDescription" 
      class="text-xs text-gray-300 mb-3 line-clamp-2 leading-relaxed"
    >
      {{ markDescription }}
    </div>

    <!-- 关联信息 -->
    <div v-if="relation && showRelationType" class="space-y-2">
      <!-- 关联类型 -->
      <div class="flex items-center gap-2">
        <component
          :is="getRelationTypeIcon(relation.relationType)"
          class="w-4 h-4"
        />
        <span
          class="text-xs px-2 py-1 rounded border"
          :class="getRelationTypeClass(relation.relationType)"
        >
          {{ getRelationTypeText(relation.relationType) }}
        </span>
      </div>

      <!-- 描述 -->
      <div v-if="relation.description" class="text-xs text-gray-400 leading-relaxed">
        {{ relation.description }}
      </div>

      <!-- 来源 -->
      <div class="flex items-center gap-1 text-xs text-gray-500">
        <span>来源:</span>
        <span class="capitalize">{{ relation.source }}</span>
        <span v-if="relation.effectId" class="text-gray-400">
          ({{ relation.effectId }})
        </span>
      </div>
    </div>

    <!-- 印记配置信息 (紧凑模式下的额外信息) -->
    <div v-if="compact && mark" class="mt-2 flex flex-wrap gap-1">
      <span 
        v-if="mark.config?.stackable" 
        class="text-xs bg-blue-600/20 text-blue-300 px-1.5 py-0.5 rounded"
      >
        可叠加
      </span>
      <span 
        v-if="mark.config?.persistent" 
        class="text-xs bg-green-600/20 text-green-300 px-1.5 py-0.5 rounded"
      >
        持续
      </span>
      <span 
        v-if="mark.tags && mark.tags.length > 0" 
        class="text-xs bg-purple-600/20 text-purple-300 px-1.5 py-0.5 rounded"
      >
        {{ mark.tags.slice(0, 2).join(', ') }}{{ mark.tags.length > 2 ? '...' : '' }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
