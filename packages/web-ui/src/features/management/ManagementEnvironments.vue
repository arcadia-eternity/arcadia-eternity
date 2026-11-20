<script setup lang="ts">
import { ref } from 'vue'
import { ElButton } from 'element-plus'
import type { ManagementController } from './useManagementController'
import EnvironmentWorkspace, { type EnvironmentNavigation } from './EnvironmentWorkspace.vue'
import EnvironmentTransfers from './EnvironmentTransfers.vue'
import EnvironmentServerUsage from './EnvironmentServerUsage.vue'
import EnvironmentImportDialog from './EnvironmentImportDialog.vue'
const { controller, navigation, hideNavigation } = defineProps<{
  controller: ManagementController
  hideNavigation?: boolean
  navigation?: EnvironmentNavigation
}>()
const editRequested = defineModel<boolean>('editRequested', { default: false })
const emit = defineEmits<{ navigate: [key: string, edit?: boolean] }>()
const {
  state,
  error,
  client,
  environments,
  installations,
  operations,
  busy,
  isAdministrator,
  environmentSaveSequence,
  downloading,
  workspacePath,
  encode,
  supported,
  saveEnvironment,
  deleteEnvironment,
  useEnvironment,
  previewExport,
  checkArchives,
  exportEnvironment,
  importEnvironment,
  downloadEnvironment,
} = controller
const importing = ref(false)
function openImport() {
  importing.value = true
  error.value = ''
}
</script>
<template>
  <EnvironmentWorkspace
    v-if="supported('workspace.environments')"
    :heading="controller.target.value === 'local' && navigation ? '本机环境库' : '服务器环境库'"
    :navigation="navigation"
    :hide-navigation="hideNavigation"
    v-model:edit-requested="editRequested"
    @navigate="(key, edit) => emit('navigate', key, edit)"
    :key="client?.context.endpoint"
    :preview-export="previewExport"
    :environments="environments"
    :installations="installations"
    :can-export="isAdministrator && supported('workspace.transfers')"
    @export="exportEnvironment"
    :can-edit="isAdministrator"
    :can-prepare="isAdministrator"
    :can-use="false"
    :show-use-actions="false"
    :can-delete="isAdministrator"
    :save-sequence="environmentSaveSequence"
    :busy="busy"
    @save="saveEnvironment"
    @remove-package="
      (environment, name, cascade) =>
        state.mutate('POST', `${workspacePath}/environments/${encode(environment.document.id)}/packages/remove`, {
          expectedRevision: environment.revision,
          name,
          cascade,
        })
    "
    @delete-draft="deleteEnvironment"
    @use="useEnvironment"
    @delete="version => state.mutate('DELETE', `${workspacePath}/installations/${encode(version.installationId)}`)"
  >
    <template #toolbar
      ><slot name="toolbar" /><ElButton v-if="supported('workspace.transfers')" :disabled="busy" @click="openImport"
        >导入环境</ElButton
      ></template
    >
    <template #detail="{ environment }"
      ><EnvironmentServerUsage
        :key="environment.document.id"
        :controller="controller"
        :environment-id="environment.document.id"
    /></template>
  </EnvironmentWorkspace>
  <EnvironmentImportDialog
    :key="client?.context.endpoint"
    :check-archives="checkArchives"
    v-model="importing"
    :busy="busy"
    :error="error"
    @import="
      async input => {
        if (await importEnvironment(input)) importing = false
      }
    "
  />
  <EnvironmentTransfers
    v-if="supported('workspace.transfers')"
    :key="client?.context.endpoint"
    mode="results"
    :installations="installations"
    :operations="operations"
    :busy="busy || !!downloading"
    :can-import="isAdministrator"
    :can-export="isAdministrator"
    @export="exportEnvironment"
    @download="downloadEnvironment"
  >
  </EnvironmentTransfers>
  <p v-if="!supported('workspace.environments')" class="hint">此管理目标尚不支持环境工作区。</p>
</template>
