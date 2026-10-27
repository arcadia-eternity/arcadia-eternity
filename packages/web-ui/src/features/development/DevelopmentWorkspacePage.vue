<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Element } from '@arcadia-eternity/const'
import { runtimeId, workRef, type Json } from '@arcadia-eternity/pack-loader/native'
import { useBattleClientStore } from '@/stores/battleClient'
import {
  DevelopmentWorkspaceClient,
  DevelopmentWorkspaceError,
  type DevelopmentWorkspaceSnapshot,
} from '@/services/developmentWorkspace'
import { defaultRecord } from '@/features/creator/content'

type Kind = 'species' | 'skill' | 'mark'
type ContentRecord = Record<string, Json> & { id: string }
type Project = { projectId: string; namespace: string; exports: { id: string; sourceKind: 'skill' | 'petMark' }[] }
const kinds = { species: 'species', skill: 'skills', mark: 'marks' } as const
const labels: Record<Kind, string> = { species: '精灵', skill: '技能', mark: '印记' }
const battle = useBattleClientStore()
const server = computed(() => battle.serverUrl)
const token = ref('')
const document = ref<Record<string, Json> | null>(null)
const project = ref<Project | null>(null)
const revision = ref('')
const openedServer = ref('')
const kind = ref<Kind>('species')
const activeId = ref('')
const newId = ref('')
const skillId = ref('')
const markId = ref('')
const markSlot = ref<'ability' | 'emblem'>('ability')
const effectId = ref('')
const useId = ref('')
const busy = ref(false)
const dirty = ref(false)
const conflict = ref(false)
const notice = ref('')
const error = ref('')
let generation = 0
let pending: AbortController | undefined
const sameServer = computed(() => !!document.value && openedServer.value === server.value)
const isObject = (value: unknown): value is Record<string, Json> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const data = computed(() => (isObject(document.value?.data) ? document.value.data : undefined))
const dataProblem = computed(() => {
  if (!document.value) return ''
  if (document.value.data !== undefined && !data.value) return '内容的 data 字段不是对象，不能使用此表单编辑。'
  for (const key of ['species', 'skills', 'marks', 'behaviors'])
    if (data.value?.[key] !== undefined && !Array.isArray(data.value[key])) return `内容的 data.${key} 不是数组。`
  return ''
})
const entries = (target: Kind): ContentRecord[] => {
  const value = data.value?.[kinds[target]]
  return Array.isArray(value)
    ? value.filter((item): item is ContentRecord => isObject(item) && typeof item.id === 'string')
    : []
}
const records = computed(() => entries(kind.value))
const selected = computed(() => records.value.find(item => item.id === activeId.value))
const recordProblem = computed(() => {
  const item = selected.value
  if (!item) return ''
  const arrays = kind.value === 'species' ? ['learnable_skills', 'ability', 'emblem'] : ['behaviors']
  for (const key of arrays)
    if (item[key] !== undefined && !Array.isArray(item[key])) return `${key} 不是数组，无法安全编辑此内容。`
  const objectKey = kind.value === 'species' ? 'baseStats' : kind.value === 'mark' ? 'config' : ''
  if (objectKey && item[objectKey] !== undefined && !isObject(item[objectKey]))
    return `${objectKey} 不是对象，无法安全编辑此内容。`
  return ''
})
const skills = computed(() => entries('skill'))
const marks = computed(() => entries('mark'))
const effects = computed(
  () => project.value?.exports.filter(item => item.sourceKind === (kind.value === 'skill' ? 'skill' : 'petMark')) ?? [],
)
const value = (record: Record<string, Json> | undefined, key: string) => record?.[key]
const string = (entry: unknown) => (typeof entry === 'string' || typeof entry === 'number' ? String(entry) : '')
const nested = (record: Record<string, Json> | undefined, key: string) =>
  isObject(record?.[key]) ? (record![key] as Record<string, Json>) : {}
const list = (record: Record<string, Json> | undefined, key: string): Json[] =>
  Array.isArray(record?.[key]) ? (record![key] as Json[]) : []
const clone = <T,>(input: T): T => JSON.parse(JSON.stringify(input)) as T
const refLabel = (input: unknown) => {
  if (typeof input === 'string') return input
  if (isObject(input) && isObject(input.$ref)) return `${string(input.$ref.projectId)}:${string(input.$ref.id)}`
  return JSON.stringify(input)
}
function ensureData(): Record<string, Json> {
  if (!document.value || dataProblem.value) throw new Error('内容结构无效，不能编辑')
  if (!isObject(document.value.data)) document.value.data = { species: [], skills: [], marks: [], behaviors: [] }
  return document.value.data as Record<string, Json>
}
function change(key: string, next: Json) {
  if (!selected.value) return
  selected.value[key] = next
  dirty.value = true
}
function changeNested(key: string, child: string, next: Json) {
  change(key, { ...nested(selected.value, key), [child]: next })
}
function changeNumber(key: string, input: string, nestedKey?: string) {
  if (input.trim() === '' || !Number.isFinite(Number(input))) return
  if (nestedKey) changeNested(nestedKey, key, Number(input))
  else change(key, Number(input))
}
function addRecord() {
  if (!project.value) return
  try {
    runtimeId(project.value.namespace, newId.value)
    const target = ensureData(),
      key = kinds[kind.value]
    const existing = target[key]
    if (existing !== undefined && !Array.isArray(existing)) throw new Error('内容列表格式无效')
    const rows = (existing ?? []) as Json[]
    if (rows.some(item => isObject(item) && item.id === newId.value)) throw new Error('该类型中已经存在此 ID')
    rows.push(defaultRecord(kind.value, newId.value))
    target[key] = rows
    activeId.value = newId.value
    newId.value = ''
    dirty.value = true
    error.value = ''
  } catch (value) {
    error.value = value instanceof Error ? value.message : String(value)
  }
}
function addSkill() {
  if (!selected.value || !project.value || !skillId.value) return
  const reference = workRef(project.value.projectId, 'skill', skillId.value)
  const existing = list(selected.value, 'learnable_skills')
  if (existing.some(item => isObject(item) && refLabel(item.skill_id) === refLabel(reference))) return
  change('learnable_skills', [...existing, { skill_id: reference, level: 1, hidden: false }])
  skillId.value = ''
}
function addMark() {
  if (!selected.value || !project.value || !markId.value) return
  const reference = workRef(project.value.projectId, 'mark', markId.value)
  const existing = list(selected.value, markSlot.value)
  if (existing.some(item => refLabel(item) === refLabel(reference))) return
  change(markSlot.value, [...existing, reference])
  markId.value = ''
}
function updateLearning(index: number, key: 'level' | 'hidden', next: Json) {
  const existing = list(selected.value, 'learnable_skills')
  const item = existing[index]
  if (!isObject(item)) return
  change(
    'learnable_skills',
    existing.map((value, at) => (at === index ? { ...item, [key]: next } : value)),
  )
}
function removeListItem(key: string, index: number) {
  change(
    key,
    list(selected.value, key).filter((_item, at) => at !== index),
  )
}
function addEffect() {
  if (!selected.value || !project.value || !effectId.value || !useId.value) return
  if (!/^[a-z0-9][a-z0-9_.-]{0,79}$/.test(useId.value)) {
    error.value = '使用 ID 只能包含小写字母、数字、点、下划线和短横线。'
    return
  }
  const existing = list(selected.value, 'behaviors')
  if (existing.some(item => isObject(item) && item.useId === useId.value)) {
    error.value = '该内容已使用此效果实例 ID。'
    return
  }
  if (!effects.value.some(item => item.id === effectId.value)) return
  change('behaviors', [
    ...existing,
    { useId: useId.value, definitionId: workRef(project.value.projectId, 'behavior', effectId.value) },
  ])
  useId.value = ''
  effectId.value = ''
  error.value = ''
}
function applyResult(result: DevelopmentWorkspaceSnapshot) {
  document.value = clone(result.content) as Record<string, Json>
  revision.value = result.revision
  project.value = clone(result.project)
  openedServer.value = server.value
  activeId.value = ''
  dirty.value = false
  conflict.value = false
}
async function run(mode: 'read' | 'save') {
  if (busy.value || !token.value) return
  if (mode === 'read' && dirty.value && !window.confirm('重新读取会丢弃当前未保存的修改，继续吗？')) return
  if (mode === 'save' && (!sameServer.value || !document.value || dataProblem.value)) return
  const requestedServer = server.value
  const epoch = ++generation
  pending?.abort()
  pending = new AbortController()
  busy.value = true
  notice.value = ''
  error.value = ''
  let client: DevelopmentWorkspaceClient | undefined
  try {
    client = new DevelopmentWorkspaceClient(requestedServer, token.value)
    const result =
      mode === 'read'
        ? await client.read(pending.signal)
        : await client.save(revision.value, clone(document.value!), pending.signal)
    if (epoch !== generation || server.value !== requestedServer) return
    applyResult(result)
    notice.value =
      mode === 'read' ? '已读取开发工作区。' : '已保存源文件。要试玩请由管理员构建并准入新环境，再从大厅选择。'
  } catch (value) {
    if (epoch !== generation) return
    conflict.value =
      value instanceof DevelopmentWorkspaceError && ['REVISION_CONFLICT', 'DEVELOPMENT_CHANGED'].includes(value.code)
    error.value = conflict.value
      ? '源文件已被其他编辑修改；你的输入仍在页面中，请复制需要保留的内容，再重新读取后合并。'
      : value instanceof Error
        ? value.message
        : '无法访问开发服务。'
  } finally {
    client?.dispose()
    if (epoch === generation) {
      busy.value = false
      pending = undefined
    }
  }
}
watch(server, () => {
  generation++
  pending?.abort()
  pending = undefined
  token.value = ''
  busy.value = false
  if (document.value) error.value = '连接的服务器已变化。旧输入仍在页面中，但不能保存到新服务器。'
})
onBeforeUnmount(() => {
  generation++
  pending?.abort()
  token.value = ''
})
</script>

<template>
  <main class="development-workspace">
    <header>
      <h1>开发服务工作区</h1>
      <p>编辑当前本机开发服务的内容源文件；效果代码由作者在项目中维护。</p>
      <p>
        目标服务器：<code>{{ server }}</code>
      </p>
      <router-link to="/creator">旧版草稿与导出</router-link>
    </header>
    <section class="panel">
      <label
        >开发令牌<input v-model="token" data-testid="development-token" type="password" autocomplete="off"
      /></label>
      <p>令牌由本机服务管理员提供，仅保存在当前页面内。正常对战服务器默认不启用开发服务。</p>
      <button :disabled="busy || !token" data-testid="development-load" @click="run('read')">读取工作区</button>
      <button
        :disabled="busy || !token || !sameServer || !document || !!dataProblem || !dirty"
        data-testid="development-save"
        @click="run('save')"
      >
        保存源文件
      </button>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p v-if="notice" role="status">{{ notice }}</p>
      <p v-if="conflict">保存未完成；重新读取前可复制下方内容。</p>
    </section>
    <fieldset v-if="document && project" :disabled="busy || !sameServer || !!dataProblem">
      <section class="panel">
        <p>
          内容包：<code>{{ project.projectId }}</code> · 命名空间：<code>{{ project.namespace }}</code>
        </p>
        <p>
          当前修订：<code>{{ revision }}</code
          ><span v-if="dirty"> · 有未保存修改</span>
        </p>
        <p v-if="dataProblem" class="error" role="alert">{{ dataProblem }}</p>
        <div class="tabs">
          <button
            v-for="tab in ['species', 'skill', 'mark'] as const"
            :key="tab"
            :aria-pressed="kind === tab"
            @click="
              kind = tab
              activeId = ''
            "
          >
            {{ labels[tab] }}（{{ entries(tab).length }}）
          </button>
        </div>
        <label
          >编辑内容<select v-model="activeId" data-testid="development-record">
            <option value="">请选择</option>
            <option v-for="item in records" :key="item.id" :value="item.id">
              {{ string(item.name) || item.id }} · {{ item.id }}
            </option>
          </select></label
        >
        <div class="fields">
          <label>新内容 ID<input v-model="newId" data-testid="development-new-id" /></label
          ><button @click="addRecord">添加{{ labels[kind] }}</button>
        </div>
      </section>
      <section v-if="selected" class="panel" data-testid="development-editor">
        <h2>{{ labels[kind] }}：{{ selected.id }}</h2>
        <p v-if="recordProblem" class="error" role="alert">{{ recordProblem }}</p>
        <fieldset :disabled="!!recordProblem">
          <label
            >名称<input
              :value="string(value(selected, 'name'))"
              data-testid="development-name"
              @input="change('name', ($event.target as HTMLInputElement).value)"
          /></label>
          <label
            >说明<textarea
              :value="string(value(selected, 'description'))"
              @input="change('description', ($event.target as HTMLTextAreaElement).value)"
            />
          </label>
          <div v-if="kind !== 'mark'" class="fields">
            <label
              >属性<select
                :value="string(value(selected, 'element'))"
                @change="change('element', ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="element in Object.values(Element)" :key="element" :value="element">{{ element }}</option>
              </select></label
            >
            <template v-if="kind === 'skill'">
              <label
                >类别<select
                  :value="string(value(selected, 'category'))"
                  @change="change('category', ($event.target as HTMLSelectElement).value)"
                >
                  <option>Physical</option>
                  <option>Special</option>
                  <option>Status</option>
                  <option>Climax</option>
                </select></label
              >
              <label
                v-for="(label, key) in { power: '威力', rage: '怒气消耗', accuracy: '命中率', priority: '优先级' }"
                :key="key"
                >{{ label
                }}<input
                  type="number"
                  :value="string(value(selected, key))"
                  @input="changeNumber(key, ($event.target as HTMLInputElement).value)"
              /></label>
            </template>
            <template v-else>
              <label
                >外观编号<input
                  type="number"
                  :value="string(value(selected, 'num'))"
                  @input="changeNumber('num', ($event.target as HTMLInputElement).value)"
              /></label>
              <label
                v-for="(label, key) in { hp: '生命', atk: '物攻', def: '物防', spa: '特攻', spd: '特防', spe: '速度' }"
                :key="key"
                >{{ label }}种族值<input
                  type="number"
                  :value="string(nested(selected, 'baseStats')[key])"
                  @input="changeNumber(key, ($event.target as HTMLInputElement).value, 'baseStats')"
              /></label>
            </template>
          </div>
          <div v-if="kind === 'mark'" class="fields">
            <label
              >持续回合（-1 为无限）<input
                type="number"
                :value="string(nested(selected, 'config').duration)"
                @input="changeNumber('duration', ($event.target as HTMLInputElement).value, 'config')"
            /></label>
            <label
              >最多层数<input
                type="number"
                :value="string(nested(selected, 'config').maxStacks)"
                @input="changeNumber('maxStacks', ($event.target as HTMLInputElement).value, 'config')"
            /></label>
            <label
              ><input
                type="checkbox"
                :checked="Boolean(nested(selected, 'config').stackable)"
                @change="changeNested('config', 'stackable', ($event.target as HTMLInputElement).checked)"
              />允许叠层</label
            >
          </div>
          <div v-if="kind === 'species'">
            <h3>可学技能</h3>
            <div v-for="(item, index) in list(selected, 'learnable_skills')" :key="index" class="fields">
              <span>{{ refLabel(isObject(item) ? item.skill_id : item) }}</span>
              <template v-if="isObject(item)"
                ><label
                  >学习等级<input
                    type="number"
                    :value="string(item.level)"
                    @input="updateLearning(index, 'level', Number(($event.target as HTMLInputElement).value))" /></label
                ><label
                  ><input
                    type="checkbox"
                    :checked="Boolean(item.hidden)"
                    @change="updateLearning(index, 'hidden', ($event.target as HTMLInputElement).checked)"
                  />隐藏技能</label
                ></template
              >
              <button @click="removeListItem('learnable_skills', index)">移除</button>
            </div>
            <label
              >添加包内技能<select v-model="skillId">
                <option value="">请选择</option>
                <option v-for="item in skills" :key="item.id" :value="item.id">
                  {{ string(item.name) || item.id }}
                </option>
              </select></label
            ><button :disabled="!skillId" @click="addSkill">添加技能引用</button>
            <h3>特性与纹章</h3>
            <div v-for="slot in ['ability', 'emblem'] as const" :key="slot">
              <strong>{{ slot === 'ability' ? '特性' : '纹章' }}</strong>
              <div v-for="(item, index) in list(selected, slot)" :key="index" class="fields">
                <span>{{ refLabel(item) }}</span
                ><button @click="removeListItem(slot, index)">移除</button>
              </div>
            </div>
            <div class="fields">
              <label
                >引用类型<select v-model="markSlot">
                  <option value="ability">特性</option>
                  <option value="emblem">纹章</option>
                </select></label
              ><label
                >包内印记<select v-model="markId">
                  <option value="">请选择</option>
                  <option v-for="item in marks" :key="item.id" :value="item.id">
                    {{ string(item.name) || item.id }}
                  </option>
                </select></label
              ><button :disabled="!markId" @click="addMark">添加印记引用</button>
            </div>
          </div>
          <div v-else>
            <h3>效果代码引用</h3>
            <p>仅列出此包声明的代码效果；声明不代表代码已准入或可运行。已有配置和使用 ID 会原样保留。</p>
            <div v-for="(item, index) in list(selected, 'behaviors')" :key="index" class="fields">
              <code>{{ JSON.stringify(item) }}</code
              ><button @click="removeListItem('behaviors', index)">移除引用</button>
            </div>
            <label
              >包内声明<select v-model="effectId" data-testid="development-effect">
                <option value="">请选择</option>
                <option v-for="item in effects" :key="item.id" :value="item.id">{{ item.id }}</option>
              </select></label
            ><label>使用 ID<input v-model="useId" data-testid="development-effect-use-id" /></label
            ><button :disabled="!effectId || !useId" @click="addEffect">添加效果引用</button>
          </div>
        </fieldset>
      </section>
    </fieldset>
    <section v-if="document && (conflict || !sameServer)" class="panel">
      <h2>保留的本地输入</h2>
      <p>此内容尚未写入服务器，可以复制后再重新读取。</p>
      <textarea :value="JSON.stringify(document, null, 2)" readonly rows="12" aria-label="保留的本地输入" />
    </section>
    <section v-if="document" class="panel"><router-link to="/">前往大厅选择已准备的环境</router-link></section>
  </main>
</template>

<style scoped>
.development-workspace {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px;
  display: grid;
  gap: 18px;
}
.panel {
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 14px;
  background: white;
}
.fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
  align-items: end;
}
label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 8px 0;
}
input,
select,
textarea {
  border: 1px solid #94a3b8;
  border-radius: 4px;
  padding: 6px;
  width: 100%;
}
input[type='checkbox'] {
  width: auto;
}
button {
  border: 1px solid #64748b;
  border-radius: 4px;
  padding: 6px 10px;
  margin: 4px;
}
button:disabled {
  opacity: 0.5;
}
.tabs {
  display: flex;
  flex-wrap: wrap;
}
.tabs button[aria-pressed='true'] {
  background: #dbeafe;
}
.error {
  color: #b91c1c;
}
</style>
