<script setup lang="ts">
import { ref, watch } from 'vue'
import type { ManagedServerSettings } from '@/types/management'
const props = defineProps<{
  settings: ManagedServerSettings
  revision: number
  saveSequence?: number
  runtimeSettings?: ManagedServerSettings
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
      <button :disabled="busy || !canEdit" @click="edit">编辑设置</button>
    </header>
    <p v-if="pendingRestart?.length" role="status" class="pending">
      设置已保存，重启服务器后应用。当前对局继续使用现行配置。
    </p>
    <p class="hint">
      当前监听 {{ runtimeSettings?.host ?? settings.host }}:{{
        runtimeSettings?.port ?? settings.port
      }}。监听地址、对外地址与网页允许来源分别配置。
    </p>
    <dl>
      <template v-for="[key, label] in fields" :key="key"
        ><dt>{{ label }}</dt>
        <dd>
          {{ runtimeSettings?.battleCapacity[key] ?? settings.battleCapacity[key]
          }}<span v-if="runtimeSettings && runtimeSettings.battleCapacity[key] !== settings.battleCapacity[key]">
            → {{ settings.battleCapacity[key] }}（待重启）</span
          >
        </dd></template
      >
    </dl>
    <form v-if="draft" @submit.prevent="save">
      <div class="grid">
        <label>监听地址<input v-model="draft.host" required /></label
        ><label>端口<input v-model.number="draft.port" type="number" min="0" max="65535" required /></label
        ><label>对外网页地址<input v-model="origin" type="url" placeholder="https://play.example.com" /></label
        ><label v-for="[key, label] in fields" :key="key"
          >{{ label
          }}<input
            v-model.number="draft.battleCapacity[key]"
            type="number"
            :min="key === 'maxConcurrentBattles' ? 1 : 0"
            required
        /></label>
      </div>
      <label>允许的网页来源（每行一个）<textarea v-model="cors" rows="3" /></label>
      <p class="hint">
        初次开服仅监听本机；选择网卡地址或 0.0.0.0 并重启后，才对网络开放。账户提供商的回调来源需同时满足部署约定。
      </p>
      <button :disabled="busy || !canEdit">保存下次启动设置</button
      ><button type="button" @click="draft = undefined">关闭编辑</button>
    </form>
  </section>
</template>
<style scoped>
.settings {
  border-top: 1px solid #e2e8f0;
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
  color: #64748b;
  font-size: 0.9rem;
}
.pending {
  background: #fffbeb;
  color: #92400e;
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
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 0.6rem;
}
label {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin: 0.5rem 0;
}
input,
textarea {
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 0.6rem;
  background: white;
  color: #0f172a;
}
button {
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  padding: 0.5rem 0.8rem;
  background: white;
  cursor: pointer;
  margin-right: 0.5rem;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
