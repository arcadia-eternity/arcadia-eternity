<script setup lang="ts">
import { ref } from 'vue'
import { ElButton, ElForm, ElFormItem, ElInput, ElInputNumber } from 'element-plus'
import type { ManagedServiceCredential } from '@/types/management'
const props = defineProps<{
  busy: boolean
  credentials?: ManagedServiceCredential[]
  issued?: { token: string; credentialId: string; expiresAt: number }
}>()
const emit = defineEmits<{ issue: [input: { expiresAt: number }]; revoke: [id: string]; dismiss: [] }>()
const hours = ref(24)
const visible = ref(false)
const removing = ref('')
function revoke(id: string) {
  emit('revoke', id)
  removing.value = ''
}
function issue() {
  if (props.busy || !Number.isFinite(hours.value) || hours.value < 1 || hours.value > 8760) return
  emit('issue', { expiresAt: Date.now() + hours.value * 3600000 })
}
</script>
<template>
  <section aria-label="自动化凭据">
    <h3>自动化凭据</h3>
    <ElForm @submit.prevent="issue" label-position="top">
      <ElFormItem label="有效期（小时）"
        ><ElInputNumber v-model="hours" :min="1" :max="8760" :disabled="busy"
      /></ElFormItem>
      <p>凭据拥有本服完整管理权。</p>
      <ElButton :disabled="busy" native-type="submit">创建凭据</ElButton>
    </ElForm>
    <section v-if="issued" aria-label="新建凭据">
      <p>仅显示一次，请保存。</p>
      <code>{{ issued.credentialId }}</code>
      <ElInput
        aria-label="凭据"
        :model-value="issued.token"
        :type="visible ? 'text' : 'password'"
        readonly
        autocomplete="off"
      />
      <ElButton @click="visible = !visible">{{ visible ? '隐藏' : '显示' }}</ElButton>
      <ElButton @click="emit('dismiss')">已保存，关闭</ElButton>
    </section>
    <section v-if="credentials?.length" aria-label="已有自动化凭据">
      <article v-for="credential in credentials" :key="credential.id">
        <code>{{ credential.id }}</code>
        <span>到期 {{ new Date(credential.expiresAt).toLocaleString() }}</span>
        <ElButton :disabled="busy" @click="removing = credential.id">撤销凭据</ElButton>
        <div v-if="removing === credential.id" role="group" aria-label="确认撤销凭据">
          <ElButton :disabled="busy" @click="revoke(credential.id)">确认撤销</ElButton>
          <ElButton :disabled="busy" @click="removing = ''">取消</ElButton>
        </div>
      </article>
    </section>
  </section>
</template>
