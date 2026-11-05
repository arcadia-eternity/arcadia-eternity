<script setup lang="ts">
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
    <p class="hint">为自动化工具单独设置作用范围、操作和有效期。凭证只能使用对应管理主体已有的权限。</p>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <form v-if="scopes.length" aria-label="签发管理凭证" @submit.prevent="issue">
      <div class="fields">
        <label
          >作用范围<select v-model="kind" :disabled="busy">
            <option v-for="item in scopes" :key="item.kind" :value="item.kind">
              {{ item.kind === 'server' ? '当前服务器' : '当前工作区' }} · {{ item.id }}
            </option>
          </select></label
        >
        <label
          >管理主体标识（留空使用本人）<input v-model="principalId" :disabled="busy" maxlength="128" autocomplete="off"
        /></label>
        <label
          >权限预设<select
            :value="preset"
            :disabled="busy"
            @change="choosePreset(($event.target as HTMLSelectElement).value as typeof preset)"
          >
            <option v-if="scope?.actions.includes('read')" value="read">只读</option>
            <option v-if="adminAvailable" value="admin">
              {{ kind === 'server' ? '服务器管理员' : '工作区管理员' }}
            </option>
            <option value="custom">自定义操作</option>
          </select></label
        >
        <label
          >有效期（小时）<input v-model="hours" :disabled="busy" type="number" min="1" max="720" step="1" required
        /></label>
      </div>
      <fieldset :disabled="busy">
        <legend>允许的操作</legend>
        <label v-for="action in scope?.actions" :key="action" class="checkbox"
          ><input v-model="selected" type="checkbox" :value="action" @change="preset = 'custom'" />{{
            actionLabels[action]
          }}</label
        >
      </fieldset>
      <button class="primary" :disabled="busy || !selected.length">签发凭证</button>
    </form>
    <p v-else class="hint">当前授权不允许签发服务凭证。</p>
    <section v-if="issuedVisible && issued" class="issued" aria-label="新签发的凭证">
      <h4>请保存此凭证</h4>
      <p>关闭后无法再次查看完整凭证。系统只保留用于校验的摘要。</p>
      <label
        >凭证<input
          :type="visible ? 'text' : 'password'"
          :value="issued.token"
          readonly
          autocomplete="off"
          spellcheck="false"
      /></label>
      <div class="actions">
        <button type="button" @click="visible = !visible">{{ visible ? '隐藏凭证' : '显示凭证' }}</button
        ><button type="button" @click="copy">复制凭证</button
        ><button type="button" @click="dismiss">已保存，关闭</button>
      </div>
      <p v-if="copied" role="status">已复制凭证。</p>
      <p v-if="copyError" role="alert" class="error">{{ copyError }}</p>
      <p>
        凭证标识：<code>{{ issued.credentialId }}</code>
      </p>
      <p>到期：{{ new Date(issued.expiresAt).toLocaleString() }}</p>
      <button :disabled="busy" @click="requestRevoke(issued.credentialId)">撤销此凭证</button>
    </section>
    <form class="revoke-form" aria-label="撤销管理凭证" @submit.prevent="requestRevoke(manualId)">
      <label
        >要撤销的凭证标识<input
          v-model="manualId"
          :disabled="busy"
          required
          maxlength="256"
          autocomplete="off" /></label
      ><button :disabled="busy || !manualId.trim()">撤销凭证</button>
    </form>
    <section v-if="credentials?.length" aria-label="已有服务凭证">
      <h3>已有服务凭证</h3>
      <article v-for="credential in credentials" :key="credential.id">
        <code>{{ credential.id }}</code>
        <p>所属身份：{{ credential.principalId }} · 到期：{{ new Date(credential.expiresAt).toLocaleString() }}</p>
        <p v-for="permission in credential.permissions" :key="`${permission.scope.kind}:${permission.scope.id}`">
          {{ permission.scope.kind === 'server' ? '服务器' : '工作区' }}：{{ permission.actions.join('、') }}
        </p>
        <button :disabled="busy" @click="requestRevoke(credential.id)">撤销此凭证</button>
      </article>
    </section>
    <div v-if="confirmId" class="confirmation" role="group" aria-label="确认撤销凭证">
      <p>
        确认撤销 <code>{{ confirmId }}</code
        >？使用它的工具将无法继续管理服务。
      </p>
      <button :disabled="busy" @click="revoke">确认撤销</button
      ><button :disabled="busy" @click="confirmId = ''">取消</button>
    </div>
  </section>
</template>

<style scoped>
.credentials {
  border-top: 1px solid #e2e8f0;
  margin-top: 1.5rem;
  padding-top: 1rem;
}
.hint {
  color: #64748b;
  font-size: 0.9rem;
  line-height: 1.6;
}
.fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 0.75rem;
}
label {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin: 0.7rem 0;
}
input,
select {
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 0.6rem;
  background: #fff;
  color: #0f172a;
}
fieldset {
  border: 1px solid #e2e8f0;
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
button {
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  padding: 0.5rem 0.8rem;
  background: #fff;
  color: #334155;
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.primary {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
}
.issued {
  padding: 1rem;
  border: 1px solid #93c5fd;
  background: #eff6ff;
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
.revoke-form label {
  flex: 1;
  margin-bottom: 0;
}
.confirmation {
  border: 1px solid #fbbf24;
  background: #fffbeb;
  border-radius: 7px;
  padding: 0.8rem;
  margin-top: 0.75rem;
}
.confirmation button {
  margin-right: 0.5rem;
}
.error {
  color: #b91c1c;
}
</style>
