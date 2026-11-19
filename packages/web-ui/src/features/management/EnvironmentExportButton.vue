<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { ElButton, ElCheckbox, ElCheckboxGroup, ElDialog } from 'element-plus'
import type {
  EnvironmentExportPreview,
  EnvironmentExportSelection,
} from '@arcadia-eternity/content-sdk/management-workspace'
import type { ManagedEnvironmentInstallation } from '@/types/management'

const props = defineProps<{
  version: ManagedEnvironmentInstallation
  preview: (id: string) => Promise<EnvironmentExportPreview>
  busy: boolean
}>()
const emit = defineEmits<{ export: [version: ManagedEnvironmentInstallation, selection: EnvironmentExportSelection] }>()
const options = ref<EnvironmentExportPreview>()
const publicPackages = computed(() => options.value?.dependencies.filter(pkg => !pkg.manual) ?? [])
const privatePackages = computed(() => options.value?.dependencies.filter(pkg => pkg.manual) ?? [])
const includePublic = ref(false)
const selectedPrivate = ref<string[]>([])
const loading = ref(false)
const error = ref('')
let disposed = false
onBeforeUnmount(() => {
  disposed = true
})
async function start() {
  if (loading.value || props.busy) return
  loading.value = true
  error.value = ''
  try {
    const result = await props.preview(props.version.installationId)
    if (disposed) return
    if (!result.dependencies.length) {
      emit('export', props.version, { revision: result.revision, locations: [] })
      return
    }
    includePublic.value = false
    selectedPrivate.value = []
    options.value = result
  } catch (cause) {
    if (!disposed) error.value = cause instanceof Error ? cause.message : '无法读取环境依赖'
  } finally {
    loading.value = false
  }
}
function confirm() {
  if (!options.value || props.busy) return
  emit('export', props.version, {
    revision: options.value.revision,
    locations: [
      ...(includePublic.value ? publicPackages.value.map(pkg => pkg.location) : []),
      ...selectedPrivate.value,
    ],
  })
  options.value = undefined
}
function size(bytes: number) {
  return bytes < 1024 * 1024 ? Math.ceil(bytes / 1024) + ' KiB' : (bytes / 1024 / 1024).toFixed(1) + ' MiB'
}
</script>

<template>
  <ElButton :disabled="busy" :loading="loading" @click="start">导出环境</ElButton>
  <span v-if="error" role="alert">{{ error }}</span>
  <ElDialog
    :model-value="!!options"
    title="导出环境"
    width="min(480px, calc(100vw - 24px))"
    append-to-body
    @close="options = undefined"
  >
    <ElCheckbox v-if="publicPackages.length" v-model="includePublic"
      >随文件附上公共依赖（{{ publicPackages.length }} 个，约
      {{ size(publicPackages.reduce((sum, pkg) => sum + pkg.bytes, 0)) }}）</ElCheckbox
    >
    <fieldset v-if="privatePackages.length">
      <legend>随文件附上私有来源的依赖</legend>
      <ElCheckboxGroup v-model="selectedPrivate">
        <ElCheckbox v-for="pkg in privatePackages" :key="pkg.location" :value="pkg.location" :title="pkg.location">
          {{ pkg.name }}@{{ pkg.version }}（约 {{ size(pkg.bytes) }}）
        </ElCheckbox>
      </ElCheckboxGroup>
    </fieldset>
    <template #footer>
      <ElButton @click="options = undefined">取消</ElButton>
      <ElButton type="primary" :disabled="busy" @click="confirm">导出</ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
fieldset {
  margin: 0.75rem 0 0;
  padding: 0;
  border: 0;
}
legend {
  font-weight: 600;
}
.el-checkbox-group {
  display: grid;
}
</style>
