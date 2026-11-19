<script setup lang="ts">
import { ref } from 'vue'
import { ElButton } from 'element-plus'
import type { ManagementController } from './useManagementController'
import EnvironmentWorkspace from './EnvironmentWorkspace.vue'
import EnvironmentTransfers from './EnvironmentTransfers.vue'
import EnvironmentServerUsage from './EnvironmentServerUsage.vue'
import EnvironmentImportDialog from './EnvironmentImportDialog.vue'
const { controller } = defineProps<{ controller: ManagementController }>()
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
    heading="服务器环境库"
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
      ><ElButton v-if="supported('workspace.transfers')" :disabled="busy" @click="openImport"
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
