<script setup lang="ts">
import { ElTag, ElCard, ElCheckbox, ElButton } from 'element-plus'
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
  can,
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
  prepareEnvironment,
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
</script>
<template>
  <section v-if="tab === 'environments' && server" aria-label="服务器玩法">
    <h2>运行环境</h2>
    <ElCard shadow="never" v-for="binding in bindings" :key="binding.id" class="binding-card">
      <header>
        <h3>
          {{
            environments.find(env => env.document.id === binding.environmentId)?.document.name ?? binding.environmentId
          }}
          <ElTag v-if="server.defaultBindingId === binding.id" size="small">默认</ElTag>
        </h3>
        <span>{{ conditionLabels[binding.condition] ?? binding.condition }}</span>
      </header>
      <dl>
        <dt>对局执行</dt>
        <dd>{{ binding.executionPolicy === 'peer' ? '由玩家托管' : '服务器执行' }}</dd>
      </dl>
      <p v-if="binding.reason" class="message error">{{ contentTaskError(binding.reason) }}</p>
      <div class="binding-options">
        <ElCheckbox
          :model-value="binding.enabled"
          :disabled="
            busy ||
            !can('server', 'bindings.manage') ||
            (!binding.enabled && !canActivateBinding) ||
            server.defaultBindingId === binding.id
          "
          :title="server.defaultBindingId === binding.id ? '先选择其他默认环境，再停用此环境' : undefined"
          @change="patchBinding(binding, { enabled: Boolean($event) })"
          >接纳新房间</ElCheckbox
        >
        <ElCheckbox
          :model-value="binding.visibility === 'public'"
          :disabled="
            busy || !can('server', 'bindings.manage') || (binding.visibility !== 'public' && !canActivateBinding)
          "
          @change="
            patchBinding(binding, {
              visibility: Boolean($event) ? 'public' : 'private',
            })
          "
          >公开展示</ElCheckbox
        >
        <ElCheckbox
          :model-value="binding.matchmakingEnabled"
          :disabled="busy || !can('server', 'bindings.manage') || (!binding.matchmakingEnabled && !canActivateBinding)"
          @change="patchBinding(binding, { matchmakingEnabled: Boolean($event) })"
          >开放匹配</ElCheckbox
        >
      </div>
      <div class="actions">
        <ElButton :disabled="busy || !canActivateBinding" @click="reloadEnvironment(binding)" native-type="button"
          >重新加载</ElButton
        >
        <ElButton
          :disabled="busy || !can('server', 'settings.manage') || binding.condition !== 'available'"
          @click="setDefault(binding)"
          native-type="button"
        >
          设为默认
        </ElButton>
        <ElButton
          :disabled="busy || !can('server', 'bindings.manage') || server.defaultBindingId === binding.id"
          :title="server.defaultBindingId === binding.id ? '先选择其他默认环境' : undefined"
          @click="deletingBinding = binding.id"
          native-type="button"
        >
          移除绑定
        </ElButton>
        <span v-if="deletingBinding === binding.id">
          <ElButton :disabled="busy" @click="deleteBinding(binding)" native-type="button">确认移除</ElButton>
          <ElButton @click="deletingBinding = ''" native-type="button">取消</ElButton>
        </span>
      </div>
    </ElCard>
  </section>
  <EnvironmentWorkspace
    v-if="tab === 'environments' && supported('workspace.environments')"
    heading="服务器环境库"
    :key="client?.context.endpoint"
    :environments="environments"
    :installations="installations"
    :can-edit="can('workspace', 'edit')"
    :can-prepare="can('workspace', 'prepare')"
    :can-use="can('workspace', 'environment.use') && can('server', 'bindings.manage')"
    :can-delete="can('workspace', 'delete')"
    :save-sequence="environmentSaveSequence"
    :busy="busy"
    @save="saveEnvironment"
    @prepare="prepareEnvironment"
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
    :can-import="can('workspace', 'edit') && can('workspace', 'prepare')"
    :can-export="can('workspace', 'export')"
    @import="importEnvironment"
    @export="exportEnvironment"
    @download="downloadEnvironment"
  >
  </EnvironmentTransfers>
  <p v-if="tab === 'environments' && !supported('workspace.environments')" class="hint">
    此管理目标尚不支持环境工作区。
  </p>
</template>
