<script setup lang="ts">
import { computed } from 'vue'
import { ElTag, ElCard, ElCheckbox, ElButton, ElSelect, ElOption } from 'element-plus'
import type { ManagementController } from './useManagementController'
import { contentTaskError } from '@/utils/contentTaskMessages'
const props = defineProps<{ controller: ManagementController; environmentId: string }>()
const {
  server,
  environments,
  installations,
  bindings,
  busy,
  isAdministrator,
  deletingBinding,
  deleteBinding,
  conditionLabels,
  canActivateBinding,
  useEnvironment,
  patchBinding,
  reloadEnvironment,
  setDefault,
} = props.controller
const selectedBindings = computed(() => bindings.value.filter(binding => binding.environmentId === props.environmentId))
const installation = computed(() =>
  installations.value.find(version => version.environmentId === props.environmentId && version.status === 'ready'),
)
</script>
<template>
  <section v-if="server" class="server-usage" aria-label="服务器使用">
    <h3>
      服务器使用 <small>{{ server.name }}</small>
    </h3>
    <div v-if="!selectedBindings.length" class="actions">
      <span>未使用</span>
      <ElButton
        :disabled="busy || !isAdministrator || !installation"
        @click="installation && useEnvironment(installation)"
        >添加到本服</ElButton
      >
    </div>
    <ElCard shadow="never" v-for="binding in selectedBindings" :key="binding.id" class="binding-card">
      <header>
        <h3>
          {{
            environments.find(env => env.document.id === binding.environmentId)?.document.name ?? binding.environmentId
          }}
          <ElTag v-if="server.defaultBindingId === binding.id" size="small">默认</ElTag>
        </h3>
        <ElTag size="small" :type="binding.condition === 'available' ? 'success' : 'info'">{{
          conditionLabels[binding.condition] ?? binding.condition
        }}</ElTag>
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
          :disabled="
            busy || !isAdministrator || binding.condition !== 'available' || server.defaultBindingId === binding.id
          "
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
          停止使用
        </ElButton>
        <span v-if="deletingBinding === binding.id">
          <ElButton :disabled="busy" @click="deleteBinding(binding)" native-type="button">确认移除</ElButton>
          <ElButton @click="deletingBinding = ''" native-type="button">取消</ElButton>
        </span>
      </div>
    </ElCard>
  </section>
</template>
<style scoped>
.server-usage {
  border-top: 1px solid var(--el-border-color-light);
  margin-top: 20px;
  padding: 16px 0;
}
.binding-card + .binding-card {
  margin-top: 12px;
}
.binding-card header,
h3,
dl {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.binding-card header {
  justify-content: space-between;
  margin-bottom: 12px;
}
h3 {
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 600;
}
.binding-card h3,
dd {
  margin: 0;
}
dt,
small {
  font-size: 13px;
  font-weight: 400;
  color: var(--el-text-color-secondary);
}
dd {
  width: 160px;
  max-width: 100%;
}
.actions,
.binding-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
.actions :deep(.el-button) {
  margin-left: 0;
}
</style>
