<script setup lang="ts">
import { ElCheckboxGroup, ElForm, ElFormItem, ElSelect, ElOption, ElInput, ElCheckbox, ElButton } from 'element-plus'
import { computed, ref, watch } from 'vue'
import type { ManagementCapabilities, ManagementScope, ManagedServiceCredential } from '@/types/management'

interface IssuedCredential {
  token: string
  credentialId: string
  expiresAt: number
}
interface CredentialRequest {
  principalId?: string
  permissions: { scope: ManagementScope; actions: string[] }[]
  expiresAt: number
}
const props = defineProps<{
  capabilities: ManagementCapabilities
  busy: boolean
  issued?: IssuedCredential
  credentials?: ManagedServiceCredential[]
}>()
const emit = defineEmits<{ issue: [input: CredentialRequest]; revoke: [credentialId: string]; dismiss: [] }>()
const actionLabels = {
  read: '查看资源',
  'environment.use': '使用环境',
  edit: '编辑环境',
  prepare: '准备版本',
  delete: '删除版本',
  export: '导出环境',
  'bindings.manage': '管理环境绑定',
  publish: '发布环境',
  'settings.manage': '修改服务器设置',
  drain: '管理对局接纳',
  'accounts.manage': '管理本服账户',
  'grants.manage': '管理授权',
} as const
type Action = keyof typeof actionLabels
const scopeActions: Record<ManagementScope['kind'], Action[]> = {
  workspace: ['read', 'environment.use', 'edit', 'prepare', 'delete', 'export', 'grants.manage'],
  server: ['read', 'bindings.manage', 'publish', 'settings.manage', 'drain', 'accounts.manage', 'grants.manage'],
}
const scopes = computed(() =>
  (['server', 'workspace'] as const).flatMap(kind => {
    const id = kind === 'server' ? props.capabilities.serverId : props.capabilities.workspaceId
    const granted = new Set(
      props.capabilities.effectivePermissions
        .filter(permission => permission.scope.kind === kind && permission.scope.id === id)
        .flatMap(permission => permission.actions),
    )
    if (!granted.has('*') && !granted.has('grants.manage')) return []
    return [{ kind, id, actions: scopeActions[kind].filter(action => granted.has('*') || granted.has(action)) }]
  }),
)
const kind = ref<ManagementScope['kind']>('server')
const scope = computed(() => scopes.value.find(item => item.kind === kind.value))
const selected = ref<Action[]>([])
const preset = ref<'read' | 'admin' | 'custom'>('read')
const principalId = ref('')
const hours = ref<number | string>(24)
const error = ref('')
const confirmId = ref('')
const manualId = ref('')
const visible = ref(false)
const dismissed = ref(false)
const copied = ref(false)
const copyError = ref('')
const adminAvailable = computed(
  () => !!scope.value && scopeActions[scope.value.kind].every(action => scope.value!.actions.includes(action)),
)
const issuedVisible = computed(() => !!props.issued && !dismissed.value)

function choosePreset(value: typeof preset.value) {
  preset.value = value
  selected.value =
    value === 'admin' && adminAvailable.value
      ? [...scope.value!.actions]
      : scope.value?.actions.includes('read')
        ? ['read']
        : []
}
watch(
  () => scopes.value.map(item => `${item.kind}:${item.id}:${item.actions.join(',')}`).join('|'),
  () => {
    if (!scope.value) kind.value = scopes.value[0]?.kind ?? 'server'
    selected.value = selected.value.filter(action => scope.value?.actions.includes(action))
    if (!selected.value.length && scope.value?.actions.includes('read')) selected.value = ['read']
    preset.value = selected.value.length === 1 && selected.value[0] === 'read' ? 'read' : 'custom'
  },
  { immediate: true },
)
watch(kind, () => {
  choosePreset('read')
  error.value = ''
  confirmId.value = ''
})
watch(
  () => props.issued,
  () => {
    dismissed.value = false
    visible.value = false
    copied.value = false
    copyError.value = ''
    confirmId.value = ''
  },
  { immediate: true },
)

function issue() {
  error.value = ''
  if (props.busy) return
  const target = scope.value
  if (!target || !selected.value.length || selected.value.some(action => !target.actions.includes(action))) {
    error.value = '请选择你有权授予的操作。'
    return
  }
  const duration = Number(hours.value)
  if (!Number.isInteger(duration) || duration < 1 || duration > 720) {
    error.value = '有效期需为 1 至 720 小时。'
    return
  }
  const principal = principalId.value.trim()
  if (principal.length > 128 || /[\u0000-\u001f\u007f]/.test(principal)) {
    error.value = '管理主体标识无效。'
    return
  }
  emit('issue', {
    ...(principal ? { principalId: principal } : {}),
    permissions: [{ scope: { kind: target.kind, id: target.id }, actions: [...new Set(selected.value)] }],
    expiresAt: Date.now() + duration * 60 * 60 * 1000,
  })
}
function requestRevoke(id: string) {
  error.value = ''
  const value = id.trim()
  if (!value || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) {
    error.value = '请输入有效的凭证标识。'
    return
  }
  confirmId.value = value
}
function revoke() {
  if (props.busy || !confirmId.value) return
  const id = confirmId.value
  confirmId.value = ''
  emit('revoke', id)
}
function dismiss() {
  dismissed.value = true
  visible.value = false
  copied.value = false
  copyError.value = ''
  emit('dismiss')
}
async function copy() {
  const issued = props.issued
  if (!issued || !issuedVisible.value) return
  copied.value = false
  copyError.value = ''
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
    await navigator.clipboard.writeText(issued.token)
    if (props.issued?.credentialId === issued.credentialId && issuedVisible.value) copied.value = true
  } catch {
    if (props.issued?.credentialId === issued.credentialId && issuedVisible.value)
      copyError.value = '自动复制不可用，请显示后手动复制。'
  }
}
</script>

<template>
  <section class="credentials" aria-label="管理服务凭证">
    <h3>自动化服务凭证</h3>
    <p class="hint">凭证只能使用管理主体已有的权限。</p>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <ElForm v-if="scopes.length" aria-label="签发管理凭证" @submit.prevent="issue" label-position="top">
      <div class="fields">
        <ElFormItem label="作用范围">
          <ElSelect v-model="kind" :disabled="busy">
            <ElOption
              v-for="item in scopes"
              :key="item.kind"
              :value="item.kind"
              :label="String(item.kind === 'server' ? '当前服务器' : '当前工作区') + ' · ' + String(item.id)"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="管理主体标识（留空使用本人）">
          <ElInput v-model="principalId" :disabled="busy" maxlength="128" autocomplete="off" />
        </ElFormItem>
        <ElFormItem label="权限预设">
          <ElSelect :model-value="preset" :disabled="busy" @change="choosePreset($event as typeof preset)">
            <ElOption v-if="scope?.actions.includes('read')" value="read" label="只读" />
            <ElOption
              v-if="adminAvailable"
              value="admin"
              :label="String(kind === 'server' ? '服务器管理员' : '工作区管理员')"
            />
            <ElOption value="custom" label="自定义操作" />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="有效期（小时）">
          <ElInput v-model="hours" :disabled="busy" type="number" min="1" max="720" step="1" required />
        </ElFormItem>
      </div>
      <ElCheckboxGroup v-model="selected" :disabled="busy" @change="preset = 'custom'">
        <p class="hint">允许的操作</p>
        <ElCheckbox
          v-for="action in scope?.actions"
          :key="action"
          class="checkbox"
          :value="action"
          @change="preset = 'custom'"
          >{{ actionLabels[action] }}</ElCheckbox
        >
      </ElCheckboxGroup>
      <ElButton class="primary" :disabled="busy || !selected.length" native-type="submit" type="primary"
        >签发凭证</ElButton
      >
    </ElForm>
    <p v-else class="hint">当前授权不允许签发服务凭证。</p>
    <section v-if="issuedVisible && issued" class="issued" aria-label="新签发的凭证">
      <h4>请保存此凭证</h4>
      <p>关闭后无法再次查看完整凭证。系统只保留用于校验的摘要。</p>
      <ElFormItem label="凭证">
        <ElInput
          :type="visible ? 'text' : 'password'"
          :model-value="issued.token"
          readonly
          autocomplete="off"
          spellcheck="false"
        />
      </ElFormItem>
      <div class="actions">
        <ElButton @click="visible = !visible" native-type="button">{{ visible ? '隐藏凭证' : '显示凭证' }}</ElButton>
        <ElButton @click="copy" native-type="button">复制凭证</ElButton>
        <ElButton @click="dismiss" native-type="button">已保存，关闭</ElButton>
      </div>
      <p v-if="copied" role="status">已复制凭证。</p>
      <p v-if="copyError" role="alert" class="error">{{ copyError }}</p>
      <p>
        凭证标识：<code>{{ issued.credentialId }}</code>
      </p>
      <p>到期：{{ new Date(issued.expiresAt).toLocaleString() }}</p>
      <ElButton :disabled="busy" @click="requestRevoke(issued.credentialId)" native-type="button">撤销此凭证</ElButton>
    </section>
    <ElForm
      class="revoke-form"
      aria-label="撤销管理凭证"
      @submit.prevent="requestRevoke(manualId)"
      label-position="top"
    >
      <ElFormItem label="要撤销的凭证标识">
        <ElInput v-model="manualId" :disabled="busy" required maxlength="256" autocomplete="off" />
      </ElFormItem>
      <ElButton :disabled="busy || !manualId.trim()" native-type="submit">撤销凭证</ElButton>
    </ElForm>
    <section v-if="credentials?.length" aria-label="已有服务凭证">
      <h3>已有服务凭证</h3>
      <article v-for="credential in credentials" :key="credential.id">
        <code>{{ credential.id }}</code>
        <p>所属身份：{{ credential.principalId }} · 到期：{{ new Date(credential.expiresAt).toLocaleString() }}</p>
        <p v-for="permission in credential.permissions" :key="`${permission.scope.kind}:${permission.scope.id}`">
          {{ permission.scope.kind === 'server' ? '服务器' : '工作区' }}：{{ permission.actions.join('、') }}
        </p>
        <ElButton :disabled="busy" @click="requestRevoke(credential.id)" native-type="button">撤销此凭证</ElButton>
      </article>
    </section>
    <div v-if="confirmId" class="confirmation" role="group" aria-label="确认撤销凭证">
      <p>
        确认撤销 <code>{{ confirmId }}</code
        >？使用它的工具将无法继续管理服务。
      </p>
      <ElButton :disabled="busy" @click="revoke" native-type="button">确认撤销</ElButton>
      <ElButton :disabled="busy" @click="confirmId = ''" native-type="button">取消</ElButton>
    </div>
  </section>
</template>

<style scoped>
.credentials {
  border-top: 1px solid var(--el-border-color-light);
  margin-top: 1.5rem;
  padding-top: 1rem;
}
.hint {
  color: var(--el-text-color-secondary);
  font-size: 0.9rem;
  line-height: 1.6;
}
.fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 0.75rem;
}
fieldset {
  border: 1px solid var(--el-border-color-light);
  border-radius: 7px;
  margin: 1rem 0;
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}
.checkbox {
  flex-direction: row;
  align-items: center;
}
.actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.issued {
  padding: 1rem;
  border: 1px solid var(--el-color-primary-light-5);
  background: var(--el-color-primary-light-9);
  border-radius: 10px;
  margin-top: 1.25rem;
}
.issued h4 {
  margin: 0;
}
.issued p,
.confirmation p {
  overflow-wrap: anywhere;
}
.issued input {
  font-family: monospace;
}
.revoke-form {
  display: flex;
  align-items: end;
  gap: 0.7rem;
  margin-top: 1rem;
}
.revoke-form .el-form-item {
  flex: 1;
  margin-bottom: 0;
}
.confirmation {
  border: 1px solid var(--el-color-warning-light-5);
  background: var(--el-color-warning-light-9);
  border-radius: 7px;
  padding: 0.8rem;
  margin-top: 0.75rem;
}
.confirmation button {
  margin-right: 0.5rem;
}
.error {
  color: var(--el-color-danger);
}
</style>
