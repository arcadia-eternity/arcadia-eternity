<script setup lang="ts">
import { computed } from 'vue'
import type {
  EffectDslNodeKind,
  EffectDslFieldTypingRule,
  OperatorDSL,
  EvaluatorDSL,
  Value,
  SelectorDSL,
  ConditionDSL,
} from '@arcadia-eternity/schema'
import { useNodeTyping } from './composables/useNodeTyping'
import OperatorEditor from './editors/operator/OperatorEditor.vue'
import EvaluatorEditor from './editors/evaluator/EvaluatorEditor.vue'
import ConditionEditor from './editors/condition/ConditionEditor.vue'
import ValueEditor from './editors/value/ValueEditor.vue'
import SelectorEditor from './editors/selector/SelectorEditor.vue'

defineOptions({ name: 'DslNode' })

const props = withDefaults(
  defineProps<{
    kind: EffectDslNodeKind | 'value' | 'selector'
    modelValue: unknown
    label?: string
    fieldName?: string
    fieldRule?: EffectDslFieldTypingRule
    nullable?: boolean
    maxDepth?: number
    depth?: number
  }>(),
  { label: undefined, fieldName: undefined, fieldRule: undefined, nullable: false, maxDepth: 6, depth: 0 },
)

const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>()

const typing = useNodeTyping()

const hasValue = computed(() => props.modelValue !== null && props.modelValue !== undefined)
const depthExceeded = computed(() => (props.depth ?? 0) >= (props.maxDepth ?? 6))

function emitUpdate(v: unknown) {
  emit('update:modelValue', v)
}
</script>

<template>
  <div class="dsl-node">
    <label v-if="label" class="dsl-label">{{ label }}</label>

    <!-- Depth guard: show inline display instead of recursive editor -->
    <div v-if="hasValue && depthExceeded" class="dsl-depth-guard">
      <span class="dsl-depth-warn">⚠ 已达最大嵌套深度</span>
      <code class="dsl-depth-value">{{
        typeof modelValue === 'object' ? JSON.stringify(modelValue) : String(modelValue)
      }}</code>
    </div>

    <!-- Nullable placeholder -->
    <template v-else-if="!hasValue && nullable">
      <button class="dsl-add-btn" @click="emitUpdate({ type: kind === 'condition' ? 'petIsActive' : 'exist' })">
        + 添加{{
          kind === 'operator'
            ? '操作符'
            : kind === 'evaluator'
              ? '求值器'
              : kind === 'condition'
                ? '条件'
                : kind === 'value'
                  ? '值'
                  : '选择器'
        }}
      </button>
    </template>

    <!-- Missing value diagnostic -->
    <div v-else-if="!hasValue" class="dsl-missing">
      <span class="dsl-missing-icon">⚠</span>
      <span class="dsl-missing-kind">{{
        kind === 'operator'
          ? '操作符'
          : kind === 'evaluator'
            ? '求值器'
            : kind === 'condition'
              ? '条件'
              : kind === 'value'
                ? '值'
                : '选择器'
      }}</span>
      <span v-if="fieldName" class="dsl-missing-field">字段 "{{ fieldName }}"</span>
      <span class="dsl-missing-msg">缺少数据</span>
    </div>

    <!-- Operator dispatch -->
    <template v-else-if="kind === 'operator'">
      <OperatorEditor :model-value="modelValue as OperatorDSL" :field-rule="fieldRule" @update:model-value="emitUpdate">
        <template v-for="(_, slot) in $slots" :key="slot" #[slot]="scope">
          <slot :name="slot" v-bind="scope" />
        </template>
      </OperatorEditor>
    </template>

    <!-- Evaluator dispatch -->
    <template v-else-if="kind === 'evaluator'">
      <EvaluatorEditor
        :model-value="modelValue as EvaluatorDSL"
        :field-rule="fieldRule"
        @update:model-value="emitUpdate"
      />
    </template>

    <!-- Condition dispatch -->
    <template v-else-if="kind === 'condition'">
      <ConditionEditor
        :model-value="modelValue as ConditionDSL | undefined"
        :field-rule="fieldRule"
        @update:model-value="emitUpdate"
      />
    </template>

    <!-- Value dispatch -->
    <template v-else-if="kind === 'value'">
      <ValueEditor
        :model-value="modelValue as Value"
        :allowed-types="typing.resolveValueTypeOptions(fieldRule).map(o => o.value)"
        :string-enum-options="typing.resolveStringEnumOptions(fieldRule)"
        :field-rule="fieldRule"
        :depth="depth"
        :max-depth="maxDepth"
        @update:model-value="emitUpdate"
      />
    </template>

    <!-- Selector dispatch -->
    <template v-else-if="kind === 'selector'">
      <SelectorEditor
        :model-value="modelValue as SelectorDSL"
        :allowed-bases="fieldRule ? typing.resolveSelectorOptions(fieldRule).map(o => o.value) : undefined"
        :field-rule="fieldRule"
        @update:model-value="emitUpdate"
      />
    </template>
  </div>
</template>

<style scoped>
.dsl-node {
  display: flex;
  flex-direction: column;
}

.dsl-label {
  font-size: var(--ae-font-xs);
  color: var(--ae-text-muted);
  font-weight: 500;
  text-transform: uppercase;
  margin-bottom: var(--ae-space-1);
}

.dsl-depth-guard {
  display: flex;
  align-items: center;
  gap: var(--ae-space-2);
  padding: var(--ae-space-1) var(--ae-space-2);
  background: rgba(230, 162, 60, 0.08);
  border-radius: var(--ae-radius-sm);
  border: 1px solid rgba(230, 162, 60, 0.2);
}

.dsl-depth-warn {
  font-size: var(--ae-font-xs);
  color: #e6a23c;
  flex-shrink: 0;
}

.dsl-depth-value {
  font-size: var(--ae-font-xs);
  color: var(--ae-text-muted);
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsl-add-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px 12px;
  font-size: var(--ae-font-xs);
  color: var(--ae-text-secondary);
  background: var(--ae-bg-surface);
  border: 1px dashed var(--ae-border-default);
  border-radius: var(--ae-radius-sm);
  cursor: pointer;
  transition: all 0.12s ease;
}

.dsl-add-btn:hover {
  color: var(--ae-accent-primary);
  border-color: var(--ae-accent-primary);
  background: var(--ae-accent-primary-subtle);
}

.dsl-missing {
  display: flex;
  align-items: center;
  gap: var(--ae-space-1);
  padding: var(--ae-space-1) var(--ae-space-2);
  background: rgba(248, 113, 113, 0.08);
  border: 1px solid rgba(248, 113, 113, 0.25);
  border-radius: var(--ae-radius-sm);
  font-size: var(--ae-font-xs);
}

.dsl-missing-icon {
  color: #f87171;
  flex-shrink: 0;
}

.dsl-missing-kind {
  font-weight: 600;
  color: #f87171;
}

.dsl-missing-field {
  color: var(--ae-text-muted);
  font-family: monospace;
}

.dsl-missing-msg {
  color: var(--ae-text-muted);
}
</style>
