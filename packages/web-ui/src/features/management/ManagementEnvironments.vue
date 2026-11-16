<script setup lang="ts">
import { computed } from 'vue'
import { ElTag, ElCard, ElCheckbox, ElButton, ElSelect, ElOption } from 'element-plus'
import type { ManagementController } from './useManagementController'
import EnvironmentWorkspace from './EnvironmentWorkspace.vue'
import EnvironmentTransfers from './EnvironmentTransfers.vue'
import { contentTaskError } from '@/utils/contentTaskMessages'
const { controller } = defineProps<{ controller: ManagementController }>()
const {
  state,
  client,
  server,
  environments,
  installations,
  bindings,
  operations,
  busy,
  isAdministrator,
  environmentSaveSequence,
  deletingBinding,
  referenceEnvironment,
  environmentReferences,
  downloading,
  deleteBinding,
  tab,
  workspacePath,
  conditionLabels,
  encode,
  supported,
  canActivateBinding,
  saveEnvironment,
  deleteEnvironment,
  useEnvironment,
  inspectReferences,
  exportEnvironment,
  importEnvironment,
  downloadEnvironment,
  patchBinding,
  reloadEnvironment,
  setDefault,
} = controller
const availableEnvironments = computed(() =>
  environments.value.filter(
    environment => !bindings.value.some(binding => binding.environmentId === environment.document.id),
  ),
)
function installationFor(id: string) {
  return installations.value.find(installation => installation.environmentId === id && installation.status === 'ready')
}
function addEnvironment(id: string) {
  const installation = installationFor(id)
  if (installation) void useEnvironment(installation)
}
</script>
<template>
  <section v-if="tab === 'environments' && server" aria-label="服务器玩法">
    <h2>运行环境</h2>
    <div class="environment-transfer">
      <section aria-label="可用环境" class="transfer-column">
        <h3>可用环境</h3>
        <ElCard v-for="environment in availableEnvironments" :key="environment.document.id" shadow="never">
          <h4>{{ environment.document.name }}</h4>
          <ElButton
            :disabled="busy || !isAdministrator || !installationFor(environment.document.id)"
            @click="addEnvironment(environment.document.id)"
            >添加到本服</ElButton
          >
        </ElCard>
      </section>
      <section aria-label="本服已使用" class="transfer-column">
        <h3>本服已使用</h3>
        <ElCard shadow="never" v-for="binding in bindings" :key="binding.id" class="binding-card">
          <header>
            <h3>
              {{
                environments.find(env => env.document.id === binding.environmentId)?.document.name ??
                binding.environmentId
              }}
              <ElTag v-if="server.defaultBindingId === binding.id" size="small">默认</ElTag>
            </h3>
            <span>{{ conditionLabels[binding.condition] ?? binding.condition }}</span>
          </header>
          <dl>
            <dt>对局执行</dt>
            <dd>
              <ElSelect
                :model-value="binding.executionPolicy ?? 'server'"
                aria-label="对局执行"
                :disabled="busy || !isAdministrator"
                @change="patchBinding(binding, { executionPolicy: $event })"
              >
                <ElOption label="服务器执行" value="server" />
                <ElOption label="由玩家托管" value="peer" />
              </ElSelect>
            </dd>
          </dl>
          <p v-if="binding.reason" class="message error">{{ contentTaskError(binding.reason) }}</p>
          <div class="binding-options">
            <ElCheckbox
              :model-value="binding.enabled"
              :disabled="
                busy ||
                !isAdministrator ||
                (!binding.enabled && !canActivateBinding) ||
                server.defaultBindingId === binding.id
              "
              :title="server.defaultBindingId === binding.id ? '先选择其他默认环境，再停用此环境' : undefined"
              @change="patchBinding(binding, { enabled: Boolean($event) })"
              >接纳新房间</ElCheckbox
            >
            <ElCheckbox
              :model-value="binding.visibility === 'public'"
              :disabled="busy || !isAdministrator || (binding.visibility !== 'public' && !canActivateBinding)"
              @change="
                patchBinding(binding, {
                  visibility: Boolean($event) ? 'public' : 'private',
                })
              "
              >公开展示</ElCheckbox
            >
            <ElCheckbox
              :model-value="binding.matchmakingEnabled"
              :disabled="busy || !isAdministrator || (!binding.matchmakingEnabled && !canActivateBinding)"
              @change="patchBinding(binding, { matchmakingEnabled: Boolean($event) })"
              >开放匹配</ElCheckbox
            >
          </div>
          <div class="actions">
            <ElButton :disabled="busy || !canActivateBinding" @click="reloadEnvironment(binding)" native-type="button"
              >重新加载</ElButton
            >
            <ElButton
              :disabled="busy || !isAdministrator || binding.condition !== 'available'"
              @click="setDefault(binding)"
              native-type="button"
            >
              设为默认
            </ElButton>
            <ElButton
              :disabled="busy || !isAdministrator || server.defaultBindingId === binding.id"
              :title="server.defaultBindingId === binding.id ? '先选择其他默认环境' : undefined"
              @click="deletingBinding = binding.id"
              native-type="button"
            >
              移回可用环境
            </ElButton>
            <span v-if="deletingBinding === binding.id">
              <ElButton :disabled="busy" @click="deleteBinding(binding)" native-type="button">确认移除</ElButton>
              <ElButton @click="deletingBinding = ''" native-type="button">取消</ElButton>
            </span>
          </div>
        </ElCard>
      </section>
    </div>
  </section>
  <EnvironmentWorkspace
    v-if="tab === 'environments' && supported('workspace.environments')"
    heading="服务器环境库"
    :key="client?.context.endpoint"
    :environments="environments"
    :installations="installations"
    :can-edit="isAdministrator"
    :can-prepare="isAdministrator"
    :can-use="false"
    :show-use-actions="false"
    :can-delete="isAdministrator"
    :save-sequence="environmentSaveSequence"
    :busy="busy"
    @save="saveEnvironment"
    @package-state="
      (environment, name, enabled, cascade) =>
        state.mutate('POST', `${workspacePath}/environments/${encode(environment.document.id)}/package-state`, {
          expectedRevision: environment.revision,
          name,
          enabled,
          cascade,
        })
    "
    @delete-draft="deleteEnvironment"
    @use="useEnvironment"
    @references="inspectReferences"
    @delete="version => state.mutate('DELETE', `${workspacePath}/installations/${encode(version.installationId)}`)"
  >
  </EnvironmentWorkspace>
  <section v-if="tab === 'environments' && referenceEnvironment" aria-label="环境引用" class="message">
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
  <EnvironmentTransfers
    v-if="tab === 'environments' && supported('workspace.transfers')"
    :key="client?.context.endpoint"
    :installations="installations"
    :operations="operations"
    :busy="busy || !!downloading"
    :can-import="isAdministrator"
    :can-export="isAdministrator"
    @import="importEnvironment"
    @export="exportEnvironment"
    @download="downloadEnvironment"
  >
  </EnvironmentTransfers>
  <p v-if="tab === 'environments' && !supported('workspace.environments')" class="hint">
    此管理目标尚不支持环境工作区。
  </p>
</template>

<style scoped>
.environment-transfer {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 20px;
}
.transfer-column {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.transfer-column h3,
.transfer-column h4 {
  margin: 0;
}
.transfer-column :deep(.el-card__body) {
  min-width: 0;
}
.transfer-column .actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.transfer-column .actions :deep(.el-button) {
  margin-left: 0;
}
@media (max-width: 800px) {
  .environment-transfer {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
