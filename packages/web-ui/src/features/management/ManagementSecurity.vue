<script setup lang="ts">
import { ElForm, ElFormItem, ElInput, ElButton } from 'element-plus'
import { onMounted, ref } from 'vue'
import { startRegistration } from '@simplewebauthn/browser'
import type { ManagementClient } from '@/services/managementClient'
const props = defineProps<{ client: ManagementClient }>()
const methods = ref<{ id: string; kind: string; label: string; createdAt: number; expiresAt?: number }[]>([])
const busy = ref(false),
  error = ref(''),
  notice = ref(''),
  label = ref('我的通行密钥'),
  confirming = ref('')
const available = window.isSecureContext && !!window.PublicKeyCredential
async function load() {
  methods.value = (await props.client.request<{ methods: typeof methods.value }>('GET', '/login-methods')).methods
}
async function run(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await action()
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法更新登录方式'
  } finally {
    busy.value = false
  }
}
async function register() {
  await run(async () => {
    const request = await props.client.request<{
      options: Parameters<typeof startRegistration>[0]['optionsJSON']
      challengeId: string
    }>('POST', '/passkeys/options', { body: {} })
    const response = await startRegistration({ optionsJSON: request.options })
    await props.client.request('POST', '/passkeys', {
      body: { challengeId: request.challengeId, response, label: label.value.trim() },
    })
    notice.value = '通行密钥已添加，下次可直接使用设备解锁登录。'
  })
}
async function revoke(id: string) {
  confirming.value = ''
  await run(async () => {
    await props.client.request('DELETE', `/login-methods/${encodeURIComponent(id)}`)
    notice.value = '已撤销，该登录方式及其关联会话不再有效。'
  })
}
onMounted(() => void run(async () => {}))
</script>
<template>
  <section class="security" aria-label="登录与安全">
    <h2>登录与安全</h2>
    <p>为当前管理身份添加通行密钥。游客模式也可使用，无需注册玩家账户。</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <ElForm @submit.prevent="register" label-position="top">
      <ElFormItem label="通行密钥名称">
        <ElInput v-model="label" maxlength="80" required :disabled="busy" />
      </ElFormItem>
      <ElButton :disabled="busy || !available || !label.trim()" native-type="submit">{{
        busy ? '正在处理…' : '添加通行密钥'
      }}</ElButton>
    </ElForm>
    <p v-if="!available">请在 HTTPS 网页或 localhost 中设置通行密钥。本机客户端管理无需登录。</p>
    <h3>通行密钥与已记住的设备</h3>
    <p v-if="!methods.length && !busy">尚未添加。首次使用登录码进入后，建议添加通行密钥，方便下次登录。</p>
    <article v-for="item in methods" :key="item.id">
      <div>
        <strong>{{ item.label }}</strong>
        <p>
          {{ item.kind === 'passkey' ? '通行密钥' : '已记住的设备' }} · 添加于
          {{ new Date(item.createdAt).toLocaleString()
          }}<span v-if="item.expiresAt"> · 有效至 {{ new Date(item.expiresAt).toLocaleString() }}</span>
        </p>
      </div>
      <ElButton :disabled="busy" @click="confirming = item.id" native-type="button">撤销</ElButton>
      <div v-if="confirming === item.id" role="group" aria-label="确认撤销登录方式">
        <p>关联的管理会话也会失效。如果这是当前设备，你需要重新登录。</p>
        <ElButton :disabled="busy" @click="revoke(item.id)" native-type="button">确认撤销</ElButton>
        <ElButton @click="confirming = ''" native-type="button">取消</ElButton>
      </div>
    </article>
  </section>
</template>
<style scoped>
.security {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 12px;
  padding: 1.5rem;
}
h2 {
  font-size: 1.4rem;
  font-weight: 600;
}
h3 {
  margin-top: 2rem;
  font-weight: 600;
}
p {
  color: var(--el-text-color-secondary);
  line-height: 1.7;
  margin: 0.6rem 0;
}
form,
article {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  margin: 1rem 0;
}
article {
  border-top: 1px solid var(--el-border-color-light);
  padding-top: 1rem;
  justify-content: space-between;
}
[role='alert'] {
  color: var(--el-color-danger);
}
</style>
