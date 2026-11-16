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
  referenceEnvironment,
  environmentReferences,
  downloading,
  workspacePath,
  encode,
  supported,
  saveEnvironment,
  deleteEnvironment,
  useEnvironment,
  inspectReferences,
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
    @add-package="
      (environment, name) =>
        state.mutate('POST', `${workspacePath}/environments/${encode(environment.document.id)}/packages/add`, {
          expectedRevision: environment.revision,
          name,
        })
    "
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
    @references="inspectReferences"
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
  <section v-if="referenceEnvironment" aria-label="环境引用" class="message">
    <h3>环境引用</h3>
    <p>
      <code>{{ referenceEnvironment }}</code>
    </p>
    <p v-if="!environmentReferences.length">无环境引用</p>
    <template v-else>
      <p>以下使用方仍保留此环境。解除绑定或等待正在使用的对局结束后，才可以删除。</p>
      <p v-for="(reference, index) in environmentReferences" :key="index">
        {{ reference.kind === 'runtime' ? '正在使用' : '持久引用' }} ·
        {{ reference.serverId ?? reference.owner ?? reference.id ?? reference.retentionId
        }}<span v-if="reference.bindingId"> · 绑定 {{ reference.bindingId }}</span>
      </p>
    </template>
    <ElButton @click="referenceEnvironment = ''" native-type="button">关闭引用</ElButton>
  </section>
  <EnvironmentImportDialog
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
