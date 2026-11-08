<script setup lang="ts">
import { ElTag, ElCard, ElCheckbox, ElFormItem, ElSelect, ElOption, ElButton } from 'element-plus'
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
  versions,
  bindings,
  operations,
  busy,
  can,
  environmentSaveSequence,
  bindingVersion,
  deletingBinding,
  referenceVersion,
  versionReferences,
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
  useVersion,
  inspectReferences,
  exportEnvironment,
  importEnvironment,
  downloadEnvironment,
  patchBinding,
  publish,
  setDefault,
} = controller
</script>
<template>
  <section v-if="tab === 'environments' && server" aria-label="服务器玩法">
    <h2>运行环境</h2>
    <p class="hint">
      一台服务器可以同时开放多个环境。默认环境用于未指定环境的新房间；其他环境仍可独立运行。发布新版本不会改变已有房间。
    </p>
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
        <dt>期望版本</dt>
        <dd>{{ binding.desiredVersionId ?? '未选择' }}</dd>
        <dt>实际版本</dt>
        <dd>{{ binding.effectiveVersionId ?? '尚未生效' }}</dd>
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
        <ElCheckbox
          :model-value="binding.selection === 'follow-ready'"
          :disabled="
            busy || !can('server', 'bindings.manage') || (binding.selection !== 'follow-ready' && !canActivateBinding)
          "
          @change="
            patchBinding(binding, {
              selection: Boolean($event) ? 'follow-ready' : 'pinned',
            })
          "
          >跟随此环境的就绪版本</ElCheckbox
        >
      </div>
      <p v-if="binding.selection === 'follow-ready'" class="hint">
        后续准备出的就绪版本会按这项授权策略发布，退出管理后仍有效。此设置不会自动更新包；撤销相应授权或关闭跟随后停止。
      </p>
      <div class="actions">
        <ElFormItem label="准备发布的版本">
          <ElSelect
            :model-value="bindingVersion[binding.id] ?? binding.desiredVersionId ?? binding.effectiveVersionId ?? ''"
            @change="bindingVersion[binding.id] = $event"
          >
            <ElOption value="" disabled label="选择版本" />
            <ElOption
              v-for="version in versions.filter(
                item => item.environmentId === binding.environmentId && item.status === 'ready',
              )"
              :key="version.versionId"
              :value="version.versionId"
              :label="
                String(version.versionId.slice(0, 16)) +
                ' · ' +
                String(version.status === 'ready' ? new Date(version.createdAt).toLocaleString() : '材料不可用')
              "
            >
            </ElOption>
          </ElSelect>
        </ElFormItem>
        <ElButton
          class="primary"
          :disabled="busy || !canActivateBinding"
          :title="canActivateBinding ? undefined : '需要服务器发布和工作区使用权限'"
          @click="publish(binding)"
          native-type="button"
          type="primary"
        >
          发布所选版本</ElButton
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
    <p v-if="!bindings.length" class="hint">还没有环境绑定。在下方准备或导入版本后，选择“用于服务器”。</p>
  </section>
  <p v-if="tab === 'environments'" class="context-note">
    服务器环境库 · 下面的草稿和固定版本保存在当前管理的服务器。本机离线环境请到“内容包 → 环境”管理。
  </p>
  <EnvironmentWorkspace
    v-if="tab === 'environments' && supported('workspace.environments')"
    :key="client?.context.endpoint"
    :environments="environments"
    :versions="versions"
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
    @use="useVersion"
    @references="inspectReferences"
    @delete="version => state.mutate('DELETE', `${workspacePath}/versions/${encode(version.versionId)}`)"
  >
  </EnvironmentWorkspace>
  <section v-if="tab === 'environments' && referenceVersion" aria-label="版本引用" class="message">
    <h3>版本引用</h3>
    <p>
      <code>{{ referenceVersion }}</code>
    </p>
    <p v-if="!versionReferences.length">当前没有引用，可以删除此版本。删除时仍会重新检查。</p>
    <template v-else>
      <p>以下使用方仍保留此版本。解除绑定或等待正在使用的对局结束后，才可以删除。</p>
      <p v-for="(reference, index) in versionReferences" :key="index">
        {{ reference.kind === 'runtime' ? '正在使用' : '持久引用' }} ·
        {{ reference.serverId ?? reference.owner ?? reference.id ?? reference.retentionId
        }}<span v-if="reference.bindingId"> · 绑定 {{ reference.bindingId }}</span>
      </p>
    </template>
    <ElButton @click="referenceVersion = ''" native-type="button">关闭引用</ElButton>
  </section>
  <EnvironmentTransfers
    v-if="tab === 'environments' && supported('workspace.transfers')"
    :key="client?.context.endpoint"
    :versions="versions"
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
