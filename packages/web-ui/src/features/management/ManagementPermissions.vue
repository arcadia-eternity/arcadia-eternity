<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElCard, ElInput, ElForm, ElFormItem, ElButton, ElSelect, ElOption } from 'element-plus'
import type { ManagementController } from './useManagementController'
import ManagementCredentials from './ManagementCredentials.vue'
const { controller } = defineProps<{ controller: ManagementController }>()
const {
  state,
  client,
  capabilities,
  administrators,
  credentials,
  busy,
  issuedCredential,
  tab,
  manageAdministrators,
  addAdministrator,
  inviteAdministrator,
  removeAdministrator,
  issueCredential,
  revokeCredential,
} = controller
const accountId = ref('')
const name = ref('')
const invitation = ref<{ code: string; expiresAt: number }>()
const removing = ref('')
const availableAccounts = computed(() =>
  state.accounts.value.filter(
    account =>
      account.status === 'active' &&
      !administrators.value.administrators.some(admin => admin.accountId === account.accountId),
  ),
)
async function invite() {
  invitation.value = await inviteAdministrator(name.value)
}
async function add() {
  await addAdministrator(accountId.value)
  if (!state.error.value) accountId.value = ''
}
async function remove() {
  await removeAdministrator(removing.value)
  if (!state.error.value) removing.value = ''
}
</script>
<template>
  <section v-if="tab === 'permissions' && manageAdministrators && capabilities" aria-label="管理员">
    <h2>管理员</h2>
    <ElForm v-if="capabilities.supportedFeatures.includes('accounts')" @submit.prevent="add" label-position="top">
      <ElFormItem label="本服账户">
        <ElSelect v-model="accountId" filterable :disabled="busy">
          <ElOption
            v-for="account in availableAccounts"
            :key="account.accountId"
            :value="account.accountId"
            :label="account.accountId"
          />
        </ElSelect>
      </ElFormItem>
      <ElButton :disabled="busy || !accountId" native-type="submit">添加管理员</ElButton>
      <ElButton v-if="state.accountCursor.value" :disabled="busy" @click="state.loadMoreAccounts"
        >加载更多账户</ElButton
      >
    </ElForm>
    <ElForm v-else @submit.prevent="invite" label-position="top">
      <ElFormItem label="管理员名称"><ElInput v-model="name" maxlength="80" :disabled="busy" /></ElFormItem>
      <ElButton :disabled="busy || !name.trim()" native-type="submit">创建管理员登录码</ElButton>
    </ElForm>
    <section v-if="invitation" aria-label="管理员登录码">
      <ElInput :model-value="invitation.code" readonly />
      <p>到期 {{ new Date(invitation.expiresAt).toLocaleString() }}</p>
      <ElButton @click="invitation = undefined">关闭</ElButton>
    </section>
    <ElCard v-for="admin in administrators.administrators" :key="admin.principalId" shadow="never">
      <strong>{{ admin.displayName }}</strong>
      <ElButton :disabled="busy || administrators.administrators.length <= 1" @click="removing = admin.principalId"
        >移除管理员</ElButton
      >
      <div v-if="removing === admin.principalId">
        <ElButton :disabled="busy" @click="remove">确认移除</ElButton>
        <ElButton :disabled="busy" @click="removing = ''">取消</ElButton>
      </div>
    </ElCard>
    <ManagementCredentials
      :credentials="credentials"
      :key="client?.context.endpoint"
      :busy="busy"
      :issued="issuedCredential"
      @issue="issueCredential"
      @revoke="revokeCredential"
      @dismiss="issuedCredential = undefined"
    />
  </section>
</template>
