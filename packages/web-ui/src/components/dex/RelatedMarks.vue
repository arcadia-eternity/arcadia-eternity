<script setup lang="ts">
import { computed, ref } from 'vue'
import { useGameDataStore } from '@/stores/gameData'
import { SkillMarkRelationService } from '@/services/skillMarkRelationService'
import MarkCard from './MarkCard.vue'
import i18next from 'i18next'
import { ShieldCheckIcon } from '@heroicons/vue/24/outline'

interface Props {
  skillId: string
  maxDisplay?: number
  showConfidence?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  maxDisplay: 6,
  showConfidence: false,
})

const gameDataStore = useGameDataStore()

// 创建关联服务实例
const relationService = computed(() => {
  return new SkillMarkRelationService(gameDataStore.skills.byId, gameDataStore.marks.byId, gameDataStore.effects.byId)
})

// 分析技能印记关联
const skillAnalysis = computed(() => {
  return relationService.value.analyzeSkillMarkRelations(props.skillId)
})

// 显示的印记关联（限制数量）
const displayedRelations = computed(() => {
  return skillAnalysis.value.relatedMarks.slice(0, props.maxDisplay)
})

// 是否有更多印记
const hasMoreMarks = computed(() => {
  return skillAnalysis.value.relatedMarks.length > props.maxDisplay
})

// 展开状态
const isExpanded = ref(false)

// 最终显示的关联
const finalRelations = computed(() => {
  if (isExpanded.value) {
    return skillAnalysis.value.relatedMarks
  }
  return displayedRelations.value
})

// 跳转到印记详情
function navigateToMark(markId: string) {
  // 这里可以添加路由跳转逻辑
  console.log('Navigate to mark:', markId)
}
</script>

<template>
  <div
    v-if="skillAnalysis.relatedMarks.length > 0"
    class="bg-slate-800/40 backdrop-blur-sm border border-slate-700 rounded-lg p-6"
  >
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-xl font-bold text-white flex items-center gap-2">
        <ShieldCheckIcon class="w-6 h-6 text-purple-400" />
        {{ i18next.t('dex.skillDetail.relatedMarks', { ns: 'webui' }) || '相关印记' }}
      </h2>
      <div class="text-sm text-gray-400">{{ skillAnalysis.totalRelations }} 个关联</div>
    </div>

    <!-- 印记网格 -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <MarkCard
        v-for="relation in finalRelations"
        :key="`${relation.markId}-${relation.relationType}`"
        :mark-id="relation.markId"
        :relation="relation"
        :show-relation-type="true"
        @click="navigateToMark"
      />
    </div>

    <!-- 展开/收起按钮 -->
    <div v-if="hasMoreMarks" class="mt-4 text-center">
      <button @click="isExpanded = !isExpanded" class="text-blue-400 hover:text-blue-300 text-sm transition-colors">
        {{ isExpanded ? '收起' : `显示更多 (${skillAnalysis.relatedMarks.length - maxDisplay} 个)` }}
      </button>
    </div>

    <!-- 空状态提示 -->
    <div v-if="skillAnalysis.relatedMarks.length === 0" class="text-center text-gray-400 py-8">
      <ShieldCheckIcon class="w-12 h-12 mx-auto mb-2 opacity-50" />
      <p>{{ i18next.t('dex.skillDetail.noRelatedMarks', { ns: 'webui' }) || '暂无相关印记' }}</p>
    </div>
  </div>
</template>

<style scoped>
.grid {
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
}

@media (max-width: 768px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>
