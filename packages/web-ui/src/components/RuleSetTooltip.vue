<template>
  <el-tooltip
    :content="tooltipContent"
    placement="top"
    :show-after="300"
    :hide-after="100"
    popper-class="rule-set-tooltip"
  >
    <template #content>
      <div class="p-3 bg-white border border-gray-200 rounded-lg shadow-lg max-w-md">
        <!-- 标题 -->
        <div class="pb-2 mb-3 border-b border-gray-100">
          <h4 class="text-base font-semibold text-gray-900 m-0">{{ ruleSetName }}</h4>
        </div>

        <!-- 描述和规则数量 -->
        <div v-if="ruleSetDescription" class="flex justify-between items-center mb-3 gap-3">
          <span class="text-sm text-gray-600 flex-1">{{ ruleSetDescription }}</span>
          <span class="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full whitespace-nowrap">
            {{ ruleCount }} 条规则
          </span>
        </div>

        <!-- 规则列表 -->
        <div v-if="rules.length > 0" class="space-y-2">
          <div class="text-sm font-medium text-gray-700 mb-2">规则详情：</div>
          <div class="max-h-72 overflow-y-auto space-y-2">
            <div
              v-for="rule in rules"
              :key="rule.id"
              class="p-2 bg-gray-50 rounded border-l-3 transition-opacity"
              :class="rule.enabled ? 'border-l-blue-400' : 'border-l-gray-300 opacity-60'"
            >
              <div class="flex justify-between items-center mb-1">
                <span class="text-sm font-medium text-gray-800">{{ rule.name }}</span>
                <span class="text-xs text-gray-500 bg-gray-200 px-2 py-0.5 rounded"> 优先级: {{ rule.priority }} </span>
              </div>
              <div class="text-xs text-gray-600 leading-relaxed mb-2">{{ rule.impact }}</div>
              <div v-if="rule.tags.length > 0" class="flex gap-1 flex-wrap">
                <span
                  v-for="tag in rule.tags"
                  :key="tag"
                  class="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded"
                >
                  {{ tag }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- 无规则提示 -->
        <div v-else class="text-center text-sm text-gray-500 py-4">暂无规则信息</div>
      </div>
    </template>

    <slot>
      <el-icon class="text-gray-400 hover:text-blue-500 cursor-help text-sm ml-1 transition-colors">
        <QuestionFilled />
      </el-icon>
    </slot>
  </el-tooltip>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { QuestionFilled } from '@element-plus/icons-vue'
import { useValidationStore } from '@/stores/validation'

interface Props {
  ruleSetId: string
}

const props = defineProps<Props>()
const validationStore = useValidationStore()

// 计算属性
const ruleSetName = computed(() => validationStore.getRuleSetName(props.ruleSetId))
const ruleSetDescription = computed(() => validationStore.getRuleSetDescription(props.ruleSetId))
const rules = computed(() => validationStore.getRuleSetRules(props.ruleSetId))
const ruleCount = computed(() => rules.value.length)

const tooltipContent = computed(() => {
  if (rules.value.length === 0) {
    return `${ruleSetName.value} - 暂无规则信息`
  }
  return `${ruleSetName.value} - ${ruleCount.value} 条规则`
})
</script>

<style>
.rule-set-tooltip {
  max-width: 400px !important;
  background: transparent !important;
  border: none !important;
  padding: 0 !important;
  box-shadow: none !important;
}

.rule-set-tooltip .el-popper__arrow::before {
  background: white !important;
  border: 1px solid #e5e7eb !important;
}
</style>
