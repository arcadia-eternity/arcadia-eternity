<script setup lang="ts">
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
    <form @submit.prevent="register">
      <label>通行密钥名称<input v-model="label" maxlength="80" required :disabled="busy" /></label>
      <button :disabled="busy || !available || !label.trim()">{{ busy ? '正在处理…' : '添加通行密钥' }}</button>
    </form>
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
      <button :disabled="busy" @click="confirming = item.id">撤销</button>
      <div v-if="confirming === item.id" role="group" aria-label="确认撤销登录方式">
        <p>关联的管理会话也会失效。如果这是当前设备，你需要重新登录。</p>
        <button :disabled="busy" @click="revoke(item.id)">确认撤销</button
        ><button @click="confirming = ''">取消</button>
      </div>
    </article>
  </section>
</template>
<style scoped>
.security {
  background: white;
  border: 1px solid #e2e8f0;
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
  color: #64748b;
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
  border-top: 1px solid #e2e8f0;
  padding-top: 1rem;
  justify-content: space-between;
}
label {
  display: grid;
  gap: 0.4rem;
}
input,
button {
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  padding: 0.6rem 0.9rem;
}
button {
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
[role='alert'] {
  color: #b91c1c;
}
</style>
