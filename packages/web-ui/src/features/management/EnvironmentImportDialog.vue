<script setup lang="ts">
import type { EnvironmentImportProbe } from '@arcadia-eternity/content-sdk/management-workspace'
import { ref } from 'vue'
import { ElDialog, ElButton } from 'element-plus'
import EnvironmentTransfers from './EnvironmentTransfers.vue'
import './managementStyles'
const props = defineProps<{
  target?: string
  modelValue: boolean
  busy: boolean
  checkArchives?: (probe: EnvironmentImportProbe) => Promise<string[]>
  error?: string
  allowDownload?: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  import: [input: { bundle: unknown; environmentId?: string; expectedRevision: null; allowDownload?: boolean }]
}>()
const transfer = ref<InstanceType<typeof EnvironmentTransfers>>()
function close(done: () => void) {
  if (!props.busy) done()
}
</script>
<template>
  <ElDialog
    :model-value="modelValue"
    title="导入环境"
    width="min(560px, calc(100vw - 24px))"
    top="6vh"
    append-to-body
    destroy-on-close
    @opened="transfer?.focusFile()"
    :before-close="close"
    :close-on-click-modal="false"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="import-body">
      <p v-if="error" role="alert" class="error">{{ error }}</p>
      <slot />
      <EnvironmentTransfers
        :key="target"
        ref="transfer"
        mode="import"
        :allow-download="allowDownload"
        :check-archives="checkArchives"
        dialog
        :installations="[]"
        :operations="[]"
        :busy="busy"
        :can-import="true"
        :can-export="false"
        @import="emit('import', $event)"
      />
    </div>
    <template #footer>
      <ElButton :disabled="busy" @click="emit('update:modelValue', false)">取消导入</ElButton>
      <ElButton type="primary" :disabled="!transfer?.canSubmit" :loading="busy" @click="transfer?.submit()"
        >确认导入新环境</ElButton
      >
    </template>
  </ElDialog>
</template>
<style scoped>
.import-body {
  max-height: calc(85dvh - 150px);
  overflow-y: auto;
}
.error {
  color: var(--el-color-danger);
}
</style>
