<script setup lang="ts">
import { ElButton, ElForm, ElFormItem, ElSelect, ElOption, ElInput } from 'element-plus'
import { computed, ref, watch } from 'vue'
import type { ManagedServerSettings } from '@/types/management'
const props = defineProps<{
  settings: ManagedServerSettings
  revision: number
  saveSequence?: number
  runtimeSettings?: ManagedServerSettings
  listenAddress?: { host: string; port: number }
  pendingRestart?: string[]
  busy: boolean
  canEdit: boolean
}>()
const emit = defineEmits<{
  save: [settings: Omit<ManagedServerSettings, 'publicOrigin'> & { publicOrigin: string | null }, revision: number]
}>()
const draft = ref<ManagedServerSettings>()
watch(
  () => props.saveSequence,
  () => {
    draft.value = undefined
  },
)
const draftRevision = ref(0)
const origin = ref(''),
  cors = ref('')
const fields = [
  ['maxConcurrentBattles', '同时进行的对局'],
  ['maxIdleWorkers', '保留的空闲执行器'],
  ['maxQueuedBattles', '等待队列上限'],
  ['battleQueueTimeoutMs', '最长排队时间（毫秒）'],
] as const
function edit() {
  draftRevision.value = props.revision
  draft.value = JSON.parse(JSON.stringify(props.settings))
  origin.value = props.settings.publicOrigin ?? ''
  cors.value = props.settings.corsOrigins.join('\n')
}
const connectionScope = computed({
  get: () => (draft.value?.host === '127.0.0.1' ? 'local' : draft.value?.host === '0.0.0.0' ? 'network' : 'custom'),
  set: (value: string) => {
    if (draft.value) draft.value.host = value === 'local' ? '127.0.0.1' : value === 'network' ? '0.0.0.0' : ''
  },
})
function save() {
  if (!draft.value) return
  emit(
    'save',
    {
      ...JSON.parse(JSON.stringify(draft.value)),
      publicOrigin: origin.value.trim() || null,
      corsOrigins: cors.value
        .split(/\r?\n/)
        .map(value => value.trim())
        .filter(Boolean),
    },
    draftRevision.value,
  )
}
</script>
<template>
  <section class="settings" aria-label="网络与容量设置">
    <header>
      <h3>网络与容量</h3>
      <ElButton :disabled="busy || !canEdit" @click="edit" native-type="button">编辑设置</ElButton>
    </header>
    <p v-if="pendingRestart?.length" role="status" class="pending">设置待重启</p>
    <p class="hint">
      当前监听
      <template v-if="listenAddress">{{ listenAddress.host }}:{{ listenAddress.port }}</template>
      <template v-else-if="runtimeSettings?.port">{{ runtimeSettings.host }}:{{ runtimeSettings.port }}</template>
      <template v-else>尚未报告实际地址</template>
    </p>
    <dl>
      <template v-for="[key, label] in fields" :key="key">
        <dt>{{ label }}</dt>
        <dd>
          {{ runtimeSettings?.battleCapacity[key] ?? settings.battleCapacity[key] }}
          <small v-if="runtimeSettings && runtimeSettings.battleCapacity[key] !== settings.battleCapacity[key]">
            重启后 {{ settings.battleCapacity[key] }}
          </small>
        </dd>
      </template>
    </dl>
    <ElForm v-if="draft" @submit.prevent="save" label-position="top">
      <div class="grid">
        <ElFormItem label="连接范围">
          <ElSelect v-model="connectionScope">
            <ElOption value="local" label="仅本机" />
            <ElOption value="network" label="允许网络连接" />
            <ElOption value="custom" label="指定网卡地址" />
          </ElSelect>
        </ElFormItem>
        <ElFormItem v-if="connectionScope === 'custom'" label="监听地址">
          <ElInput v-model="draft.host" required />
        </ElFormItem>
        <ElFormItem label="端口">
          <ElInput name="port" v-model.number="draft.port" type="number" min="0" max="65535" required />
        </ElFormItem>
        <ElFormItem label="对外网页地址">
          <ElInput name="publicOrigin" v-model="origin" type="url" placeholder="https://play.example.com" />
        </ElFormItem>
        <ElFormItem v-for="[key, label] in fields" :key="key" :label="String(label)">
          <ElInput
            :name="key"
            v-model.number="draft.battleCapacity[key]"
            type="number"
            :min="key === 'maxConcurrentBattles' ? 1 : 0"
            required
          />
        </ElFormItem>
      </div>
      <ElFormItem label="允许的网页来源（每行一个）">
        <ElInput v-model="cors" :rows="3" type="textarea" />
      </ElFormItem>
      <p v-if="origin.trim()" class="hint">公网访问需要可访问的公网入口。</p>
      <ElButton :disabled="busy || !canEdit" native-type="submit">保存下次启动设置</ElButton>
      <ElButton @click="draft = undefined" native-type="button">关闭编辑</ElButton>
    </ElForm>
  </section>
</template>
<style scoped>
.settings {
  border-top: 1px solid var(--el-border-color-light);
  margin-top: 1rem;
  padding-top: 1rem;
}
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
h3 {
  margin: 0;
}
.hint {
  color: var(--el-text-color-secondary);
  font-size: 0.9rem;
}
.pending {
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning);
  padding: 0.75rem;
  border-radius: 7px;
}
dl {
  display: grid;
  grid-template-columns: minmax(150px, 1fr) 2fr;
  gap: 0.5rem;
  font-size: 0.9rem;
}
dd {
  margin: 0;
}
dd small {
  margin-inline-start: 0.5rem;
  color: var(--el-text-color-secondary);
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 0.6rem;
}
</style>
