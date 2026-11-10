<script setup lang="ts">
import { ElCard, ElForm, ElFormItem, ElInput, ElButton, ElSelect, ElOption } from 'element-plus'
import type { ManagementController } from './useManagementController'
import ManagementCredentials from './ManagementCredentials.vue'
const { controller } = defineProps<{ controller: ManagementController }>()
const {
  state,
  client,
  capabilities,
  grants,
  credentials,
  busy,
  can,
  principalId,
  newPrincipalName,
  newPrincipalAccount,
  issuedCredential,
  grantRole,
  tab,
  encode,
  manageGrants,
  createPrincipal,
  issueCredential,
  revokeCredential,
  addGrant,
} = controller
</script>
<template>
  <section v-if="tab === 'permissions' && manageGrants && capabilities" aria-label="管理员授权">
    <h2>管理员与授权</h2>
    <details>
      <summary>新建管理主体</summary>
      <ElForm class="grant-form" @submit.prevent="createPrincipal" label-position="top">
        <ElFormItem label="显示名称">
          <ElInput v-model="newPrincipalName" required maxlength="80" />
        </ElFormItem>
        <ElFormItem v-if="can('server', 'grants.manage')" label="关联本服账户标识（可选）">
          <ElInput v-model="newPrincipalAccount" />
        </ElFormItem>
        <ElButton :disabled="busy || !newPrincipalName.trim()" native-type="submit">创建主体</ElButton>
      </ElForm>
      <p class="hint">关联账户后仍需单独授权。</p>
    </details>
    <ElForm class="grant-form" @submit.prevent="addGrant" label-position="top">
      <ElFormItem label="管理主体标识">
        <ElInput v-model="principalId" required autocomplete="off" />
      </ElFormItem>
      <ElFormItem label="角色">
        <ElSelect v-model="grantRole">
          <ElOption value="viewer" :disabled="!can('server', 'grants.manage')" label="服务器只读" />
          <ElOption value="server-admin" :disabled="!can('server', 'grants.manage')" label="服务器管理员" />
          <ElOption value="workspace-admin" :disabled="!can('workspace', 'grants.manage')" label="工作区管理员" />
        </ElSelect>
      </ElFormItem>
      <ElButton class="primary" :disabled="busy || !principalId.trim()" native-type="submit" type="primary"
        >添加授权</ElButton
      >
    </ElForm>
    <ElCard shadow="never" v-for="grant in grants" :key="grant.id" class="grant">
      <strong>{{ grant.principalId }}</strong>
      <p>{{ grant.scope.kind === 'server' ? '服务器' : '工作区' }} · {{ grant.scope.id }}</p>
      <p>{{ grant.actions.join('、') }}</p>
      <ElButton
        :disabled="busy"
        @click="
          state.mutate('POST', `/grants/${encode(grant.id)}/revoke`, { revision: grant.revision }, grant.revision)
        "
        native-type="button"
      >
        撤销授权
      </ElButton>
    </ElCard>
    <ManagementCredentials
      :credentials="credentials"
      :key="client?.context.endpoint"
      :capabilities="capabilities"
      :busy="busy"
      :issued="issuedCredential"
      @issue="issueCredential"
      @revoke="revokeCredential"
      @dismiss="issuedCredential = undefined"
    >
    </ManagementCredentials>
  </section>
</template>
