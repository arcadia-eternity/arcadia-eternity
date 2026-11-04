<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ManagedEnvironment, ManagedEnvironmentDocument, ManagedEnvironmentVersion } from '@/types/management'

const props = defineProps<{
  environments: ManagedEnvironment[]
  versions: ManagedEnvironmentVersion[]
  canEdit: boolean
  canPrepare: boolean
  canDelete?: boolean
  canUse?: boolean
  saveSequence?: number
  busy: boolean
}>()
const emit = defineEmits<{
  save: [document: ManagedEnvironmentDocument, expectedRevision: string | null]
  prepare: [environment: ManagedEnvironment]
  use: [version: ManagedEnvironmentVersion, executionPolicy?: 'server' | 'peer']
  delete: [version: ManagedEnvironmentVersion]
  references: [version: ManagedEnvironmentVersion]
}>()
const editing = ref(false)
watch(
  () => props.saveSequence,
  () => {
    editing.value = false
  },
)
const revision = ref<string | null>(null)
const document = ref<ManagedEnvironmentDocument>()
const packageRows = ref<{ name: string; version: string }[]>([])
const sourceText = ref('')
const validation = ref('')
const selectedId = ref('')
const deletingVersion = ref('')
function deleteVersion(version: ManagedEnvironmentVersion) {
  deletingVersion.value = ''
  emit('delete', version)
}
const contentKinds = ['species', 'skills', 'marks'] as const
const contentLabels = { species: '精灵', skills: '技能', marks: '印记' }
function setRuleList(side: 'allow' | 'deny', kind: (typeof contentKinds)[number], value: string) {
  if (!document.value) return
  const values = [
    ...new Set(
      value
        .split(/[\n,，]/)
        .map(item => item.trim())
        .filter(Boolean),
    ),
  ]
  const current: Partial<Record<(typeof contentKinds)[number], string[]>> = { ...document.value.rules[side] }
  if (values.length) current[kind] = values
  else delete current[kind]
  if (Object.keys(current).length) document.value.rules[side] = current
  else delete document.value.rules[side]
}
function setTeamSize(key: 'minSize' | 'maxSize', value: string) {
  if (!document.value) return
  const team = { ...document.value.rules.team }
  if (value === '') delete team[key]
  else team[key] = Number(value)
  document.value.rules.team = team
}
const selectedVersions = computed(() =>
  props.versions.filter(version => !selectedId.value || version.environmentId === selectedId.value),
)
const clone = (value: ManagedEnvironmentDocument): ManagedEnvironmentDocument => JSON.parse(JSON.stringify(value))

function edit(environment?: ManagedEnvironment) {
  revision.value = environment?.revision ?? null
  document.value = environment
    ? clone(environment.document)
    : { schemaVersion: 2, id: '', name: '', packages: {}, sources: [], rules: { schemaVersion: 1 }, requires: {} }
  packageRows.value = Object.entries(document.value.packages).map(([name, version]) => ({ name, version }))
  sourceText.value = document.value.sources.join('\n')
  validation.value = ''
  editing.value = true
}
function save() {
  if (!document.value) return
  const rows = packageRows.value.map(row => ({ name: row.name.trim(), version: row.version.trim() }))
  if (rows.some(row => !row.name || !row.version) || new Set(rows.map(row => row.name)).size !== rows.length) {
    validation.value = '请为每个内容包填写名称和版本；包名不能重复。'
    return
  }
  emit(
    'save',
    {
      ...clone(document.value),
      packages: Object.fromEntries(rows.map(row => [row.name, row.version])),
      sources: sourceText.value
        .split(/\r?\n/)
        .map(value => value.trim())
        .filter(Boolean),
    },
    revision.value,
  )
}
</script>

<template>
  <section class="environment-workspace" aria-label="环境工作区">
    <header class="section-heading">
      <div>
        <h2>环境</h2>
        <p>编辑组合后准备固定版本，再选择要发布到服务器的版本。</p>
      </div>
      <button :disabled="!canEdit || busy" :title="!canEdit ? '没有编辑此工作区的权限' : undefined" @click="edit()">
        新建环境
      </button>
    </header>
    <p v-if="!canEdit" class="hint">你可以查看此工作区；编辑与准备需要相应授权。</p>
    <div class="environment-grid">
      <article v-for="environment in environments" :key="environment.document.id" class="environment-card">
        <h3>{{ environment.document.name }}</h3>
        <p>
          {{ Object.keys(environment.document.packages).length }} 个额外内容包 ·
          {{ environment.document.sources.length }} 个来源
        </p>
        <ul v-if="Object.keys(environment.document.packages).length" class="package-list">
          <li v-for="(version, name) in environment.document.packages" :key="name">
            {{ name }} <span>{{ version }}</span>
          </li>
        </ul>
        <p v-if="environment.document.rules?.tier">分级：{{ environment.document.rules.tier }}</p>
        <div class="actions">
          <button :disabled="!canEdit || busy" @click="edit(environment)">编辑</button>
          <button
            :disabled="!canPrepare || busy"
            :title="!canPrepare ? '没有准备此环境的权限' : undefined"
            @click="emit('prepare', environment)"
          >
            准备版本
          </button>
          <button @click="selectedId = environment.document.id">查看版本</button>
        </div>
      </article>
      <p v-if="!environments.length" class="hint">工作区还没有环境。新建环境后可添加内容包并准备版本。</p>
    </div>
    <form v-if="editing && document" class="environment-editor" aria-label="编辑环境" @submit.prevent="save">
      <h3>{{ revision === null ? '新建环境' : '编辑环境' }}</h3>
      <p v-if="validation" role="alert" class="error">{{ validation }}</p>
      <div class="field-row">
        <label>名称<input v-model="document.name" required maxlength="80" /></label
        ><label
          >标识<input
            v-model="document.id"
            required
            pattern="[a-z0-9][a-z0-9_-]{0,79}"
            :disabled="revision !== null"
            placeholder="friends"
        /></label>
      </div>
      <fieldset>
        <legend>额外内容包</legend>
        <div v-for="(row, index) in packageRows" :key="index" class="package-row">
          <label>包名<input v-model="row.name" placeholder="@author/package" required /></label
          ><label>版本<input v-model="row.version" placeholder="1.0.0" required /></label
          ><button type="button" @click="packageRows.splice(index, 1)">移除</button>
        </div>
        <button type="button" @click="packageRows.push({ name: '', version: '' })">添加内容包</button>
      </fieldset>
      <details>
        <summary>来源与规则</summary>
        <label>已登记的来源包名（每行一个）<textarea v-model="sourceText" rows="3" /></label>
        <label
          >环境分级<input
            :value="document.rules.tier ?? ''"
            @input="document.rules.tier = ($event.target as HTMLInputElement).value || undefined"
            placeholder="可选"
        /></label>
        <div class="field-row">
          <label
            >队伍最少数量<input
              type="number"
              min="1"
              max="100"
              :value="document.rules.team?.minSize"
              @input="setTeamSize('minSize', ($event.target as HTMLInputElement).value)" /></label
          ><label
            >队伍最多数量<input
              type="number"
              min="1"
              max="100"
              :value="document.rules.team?.maxSize"
              @input="setTeamSize('maxSize', ($event.target as HTMLInputElement).value)"
          /></label>
        </div>
        <label
          ><input
            type="checkbox"
            :checked="document.rules.team?.uniqueSpecies"
            @change="
              document.rules.team = {
                ...document.rules.team,
                uniqueSpecies: ($event.target as HTMLInputElement).checked,
              }
            "
          />队伍内精灵不重复</label
        >
        <fieldset v-for="side in ['allow', 'deny'] as const" :key="side">
          <legend>{{ side === 'allow' ? '允许内容（留空表示不额外限制）' : '禁止内容' }}</legend>
          <label v-for="kind in contentKinds" :key="kind"
            >{{ contentLabels[kind] }}标识（每行一个）<textarea
              :value="document.rules[side]?.[kind]?.join('\n') ?? ''"
              rows="2"
              @input="setRuleList(side, kind, ($event.target as HTMLTextAreaElement).value)"
            />
          </label>
        </fieldset>
        <p class="hint">规则随准备的版本固定，已有兼容要求随本次保存保留。来源须先由宿主登记。</p>
      </details>
      <div class="actions">
        <button class="primary" :disabled="busy || !canEdit">保存环境</button
        ><button type="button" @click="editing = false">关闭编辑</button>
      </div>
      <p class="hint">保存不会改变已发布版本。发生版本冲突时，你的编辑内容会留在这里。</p>
    </form>
    <header class="section-heading">
      <h3>固定版本</h3>
      <button v-if="selectedId" @click="selectedId = ''">查看全部</button>
    </header>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>环境</th>
            <th>版本</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="version in selectedVersions" :key="version.versionId">
            <td>{{ version.status === 'ready' ? version.document.name : (version.environmentId ?? '未知环境') }}</td>
            <td>
              <code :title="version.versionId">{{ version.versionId.slice(0, 16) }}</code
              ><small v-if="version.status === 'ready'">{{ new Date(version.createdAt).toLocaleString() }}</small>
            </td>
            <td>
              {{ version.status === 'ready' ? '已准备' : '材料不可用'
              }}<small v-if="version.status === 'unavailable'">{{ version.reason }}</small>
            </td>
            <td>
              <button :disabled="busy" @click="emit('references', version)">查看引用</button>
              <button
                :disabled="busy || version.status !== 'ready' || !canUse"
                :title="!canUse ? '需要工作区使用和服务器绑定管理权限' : undefined"
                @click="emit('use', version)"
              >
                用于服务器
              </button>
              <button
                :disabled="busy || version.status !== 'ready' || !canUse"
                :title="!canUse ? '需要工作区使用和服务器绑定管理权限' : undefined"
                @click="emit('use', version, 'peer')"
              >
                用于玩家托管
              </button>
              <button
                v-if="canDelete && deletingVersion !== version.versionId"
                :disabled="busy"
                @click="deletingVersion = version.versionId"
              >
                删除版本
              </button>
              <span v-if="deletingVersion === version.versionId"
                ><button :disabled="busy" @click="deleteVersion(version)">确认删除</button
                ><button @click="deletingVersion = ''">取消</button></span
              >
            </td>
          </tr>
          <tr v-if="!selectedVersions.length">
            <td colspan="4">还没有固定版本。</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.section-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  margin: 1.5rem 0 1rem;
}
.section-heading h2,
.section-heading h3 {
  margin: 0;
}
.section-heading p,
.hint {
  color: #64748b;
  font-size: 0.9rem;
}
.environment-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 1rem;
}
.environment-card,
.environment-editor {
  border: 1px solid #dbe2ea;
  border-radius: 12px;
  padding: 1rem;
  background: #fff;
}
.environment-card h3 {
  margin: 0;
}
.environment-card p {
  color: #64748b;
  font-size: 0.9rem;
}
.package-list {
  padding-left: 1rem;
  font-size: 0.85rem;
  overflow-wrap: anywhere;
}
.package-list span {
  color: #64748b;
}
.actions,
.field-row,
.package-row {
  display: flex;
  align-items: end;
  gap: 0.65rem;
  flex-wrap: wrap;
}
.environment-editor {
  margin-top: 1rem;
}
.field-row > label,
.package-row > label {
  flex: 1;
  min-width: 140px;
}
label {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin: 0.7rem 0;
}
input,
textarea {
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 0.6rem;
  color: #0f172a;
  background: #fff;
}
fieldset {
  border: 1px solid #dbe2ea;
  border-radius: 8px;
  margin: 1rem 0;
}
.table-wrap {
  overflow: auto;
}
table {
  border-collapse: collapse;
  width: 100%;
  text-align: left;
}
td,
th {
  padding: 0.8rem;
  border-bottom: 1px solid #e2e8f0;
}
small {
  display: block;
  color: #64748b;
  margin-top: 0.25rem;
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
  color: #fff;
  border-color: #2563eb;
}
.error {
  color: #b91c1c;
}
details {
  margin: 1rem 0;
}
summary {
  cursor: pointer;
}
</style>
