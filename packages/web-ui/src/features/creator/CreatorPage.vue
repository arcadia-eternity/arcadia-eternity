<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, toRaw } from 'vue'
import { Element } from '@arcadia-eternity/const'
import {
  createDraft,
  compileRelease,
  prepareWorkEnvironment,
  exportArchive,
  parseArchive,
  decodeBytes,
  forkDraft,
  runtimeId,
  collection,
  emptyWorkspace,
  type Json,
  type WorkDraft,
  type WorkKind,
  type WorkRecord,
  type WorkWorkspace,
  type WorkArchive,
  type NativeWorkSelection,
} from '@arcadia-eternity/pack-loader/native'
import { createWorkRepository } from '@/services/workStorage'
import { loadCreatorBase, defaultRecord, referenceOptions, releaseLock, workHost } from './content'
import BehaviorEditor from './BehaviorEditor.vue'
import { selectLearnableSkills } from './records'
import TrialBattle from './TrialBattle.vue'
import type { ContentPrototypeData } from '@arcadia-eternity/battle/v4'
const workspace = shallowRef<WorkWorkspace>(emptyWorkspace())
const draft = ref<WorkDraft>()
const base = shallowRef<ContentPrototypeData>({ species: [], skills: [], marks: [] })
const ready = ref(false),
  busy = ref(false),
  error = ref(''),
  notice = ref('')
const title = ref('我的作品'),
  namespace = ref('my_pack'),
  localId = ref(''),
  copyId = ref('')
const kind = ref<'species' | 'skill' | 'mark'>('skill'),
  activeId = ref(''),
  releaseVersion = ref('1.0.0')
const pendingImport = shallowRef<WorkArchive>()
const preview = shallowRef<{
  selection: NativeWorkSelection
  species: { id: string; label: string; skills: string[]; ability?: string; emblem?: string }[]
}>()
let repository: ReturnType<typeof createWorkRepository>
const installed = computed(() => Object.values(workspace.value.releases))
const records = computed(() => draft.value?.data[collection[kind.value]] ?? [])
const record = computed(() => records.value.find(item => item.id === activeId.value))
const refs = (target: WorkKind) =>
  draft.value ? referenceOptions(target, draft.value, base.value, installed.value) : []
const marks = computed(() => refs('mark')),
  skills = computed(() => refs('skill'))
const field = (name: string) => record.value?.[name]
const fields = (name: string) => (field(name) ?? {}) as Record<string, Json>
const array = (name: string) => (Array.isArray(field(name)) ? field(name) : []) as Json[]
const text = (event: Event) => (event.target as HTMLInputElement).value
function set(name: string, value: Json) {
  if (record.value) record.value[name] = value
}
function setNested(name: string, key: string, value: Json) {
  set(name, { ...fields(name), [key]: value })
}
function selectKind(value: 'species' | 'skill' | 'mark') {
  kind.value = value
  activeId.value = ''
}
function removeRecord() {
  if (draft.value) draft.value.data[collection[kind.value]] = records.value.filter(item => item.id !== activeId.value)
  activeId.value = ''
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(toRaw(value))) as T
async function refresh() {
  workspace.value = await repository.read()
}
async function run(action: () => Promise<void> | void) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await action()
  } catch (value) {
    error.value = value instanceof Error ? value.message : String(value)
  } finally {
    busy.value = false
  }
}
async function save() {
  if (draft.value) draft.value = await repository.saveDraft(clone(draft.value))
  await refresh()
  notice.value = '草稿已保存到本机'
}
async function open(id: string) {
  await save()
  draft.value = clone(workspace.value.drafts[id])
  activeId.value = ''
  preview.value = undefined
}
async function create() {
  await save()
  draft.value = createDraft(crypto.randomUUID(), title.value, namespace.value)
  activeId.value = ''
  preview.value = undefined
  await save()
}
async function fork() {
  if (!draft.value) return
  const copy = forkDraft(clone(draft.value), crypto.randomUUID(), namespace.value)
  draft.value = await repository.saveDraft(copy)
  await refresh()
  preview.value = undefined
}
function add() {
  if (!draft.value) return
  runtimeId(draft.value.project.namespace, localId.value)
  if (records.value.some(item => item.id === localId.value)) throw new Error('此类型中已经存在相同 ID')
  const source = (base.value[collection[kind.value]] as WorkRecord[]).find(item => item.id === copyId.value)
  records.value.push(source ? { ...clone(source), id: localId.value } : defaultRecord(kind.value, localId.value))
  activeId.value = localId.value
  localId.value = ''
  copyId.value = ''
}
async function compile(version: string) {
  if (!draft.value) throw new Error('请先选择作品')
  return compileRelease(
    clone(draft.value),
    version,
    workHost(base.value),
    installed.value,
    Object.fromEntries(Object.entries(workspace.value.blobs).map(([hash, bytes]) => [hash, decodeBytes(bytes)])),
  )
}
async function publish() {
  await save()
  const release = await compile(releaseVersion.value)
  await repository.installRelease(release)
  await refresh()
  notice.value = `已在本机创建固定版本 ${release.releaseVersion}，可导出分享`
}
async function trial() {
  const release = await compile('0.0.0-preview')
  const selected = [
    release,
    ...workspace.value.selected
      .filter(lock => lock.projectId !== release.project.id)
      .map(lock => workspace.value.releases[`${lock.projectId}@${lock.version}`]),
  ]
  const environment = await prepareWorkEnvironment(workHost(base.value), selected, installed.value)
  const names = new Map(
    draft.value!.data.species.map(item => [
      runtimeId(draft.value!.project.namespace, item.id),
      String(item.name ?? item.id),
    ]),
  )
  const species = environment.data.species as {
    id: string
    learnable_skills: { skill_id: string }[]
    ability: string[]
    emblem: string[]
  }[]
  preview.value = {
    selection: { base: clone(base.value), selected, installed: environment.releases },
    species: species
      .filter(item => names.has(item.id))
      .map(item => ({
        id: item.id,
        label: names.get(item.id)!,
        skills: item.learnable_skills.map(skill => skill.skill_id),
        ...(item.ability[0] ? { ability: item.ability[0] } : {}),
        ...(item.emblem[0] ? { emblem: item.emblem[0] } : {}),
      })),
  }
  notice.value = '校验通过，已固定本次试战内容'
}
async function download(mode: 'draft' | 'release' | 'selection', key?: string) {
  const selected = key
    ? [workspace.value.releases[key]]
    : mode === 'selection'
      ? workspace.value.selected.map(lock => workspace.value.releases[`${lock.projectId}@${lock.version}`])
      : []
  const data = await exportArchive({
    ...(mode === 'draft' && draft.value ? { drafts: [clone(draft.value)] } : { selected }),
    installed: installed.value,
    blobs: workspace.value.blobs,
  })
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${draft.value?.project.namespace ?? 'works'}${key ? '-release' : '-draft'}.arcadia`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function chooseFile(event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (file.size > 32 * 1024 * 1024) throw new Error('作品文件超过 32 MiB')
  pendingImport.value = await parseArchive(await file.text())
}
async function importPending() {
  if (!pendingImport.value) return
  await repository.importArchive(pendingImport.value)
  pendingImport.value = undefined
  await refresh()
  notice.value = '作品已导入；启用版本后可供本机使用'
}
async function toggle(key: string) {
  const release = workspace.value.releases[key],
    lock = releaseLock(release)
  const enabled = workspace.value.selected.some(
    item => item.projectId === lock.projectId && item.digest === lock.digest,
  )
  const selected = workspace.value.selected.filter(item => item.projectId !== lock.projectId)
  if (!enabled) selected.push(lock)
  const roots = selected.map(item => workspace.value.releases[`${item.projectId}@${item.version}`])
  await prepareWorkEnvironment(workHost(base.value), roots, installed.value)
  await repository.select(selected)
  await refresh()
}
function setDependency(key: string, enabled: boolean) {
  if (!draft.value) return
  const release = workspace.value.releases[key]
  draft.value.dependencies = draft.value.dependencies.filter(dep => dep.projectId !== release.project.id)
  if (enabled) draft.value.dependencies.push(releaseLock(release))
}
onMounted(() => {
  void run(async () => {
    repository = createWorkRepository()
    base.value = await loadCreatorBase()
    await refresh()
    ready.value = true
  })
})
</script>
<template>
  <main class="creator">
    <header>
      <h1>创作工坊</h1>
      <p>设计精灵、技能与印记，组合已有效果，保存并分享你的作品。</p>
    </header>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="notice" role="status" class="notice">{{ notice }}</p>
    <fieldset :disabled="busy || !ready">
      <div class="creator-layout">
        <aside class="panel">
          <h2>本机作品</h2>
          <button
            v-for="work in workspace.drafts"
            :key="work.project.id"
            class="work-item"
            :aria-pressed="draft?.project.id === work.project.id"
            @click="run(() => open(work.project.id))"
          >
            {{ work.project.title }}<small>{{ work.project.namespace }}:…</small>
          </button>
          <label>作品名称<input v-model="title" maxlength="200" /></label
          ><label>命名空间<input v-model="namespace" placeholder="my_pack" /></label>
          <p class="help">完整 ID 形如 my_pack:ice_strike。命名空间使用小写字母、数字、点、下划线和短横线。</p>
          <button @click="run(create)">创建作品</button
          ><button :disabled="!draft" @click="run(fork)">以此命名空间另存副本</button>
          <label class="import"
            >导入作品文件<input type="file" accept=".arcadia,application/json" @change="run(() => chooseFile($event))"
          /></label>
          <div v-if="pendingImport">
            <p>
              即将导入 {{ pendingImport.drafts.length }} 份草稿、{{ pendingImport.releases.length }}
              个固定版本。已有草稿不会被覆盖。
            </p>
            <button @click="run(importPending)">导入这些作品</button
            ><button @click="pendingImport = undefined">取消</button>
          </div>
        </aside>
        <section v-if="draft" class="panel editor">
          <div class="toolbar">
            <h2>{{ draft.project.title }}</h2>
            <button @click="run(save)">保存草稿</button><button @click="run(() => download('draft'))">导出草稿</button
            ><button @click="run(trial)">校验并准备试战</button>
          </div>
          <div class="fields">
            <label>作品标题<input v-model="draft.project.title" maxlength="200" /></label
            ><label>作品命名空间<input v-model="draft.project.namespace" /></label>
          </div>
          <label>作品说明<textarea v-model="draft.project.description" rows="2" /></label>
          <div class="toolbar">
            <button
              v-for="tab in ['species', 'skill', 'mark'] as const"
              :key="tab"
              :aria-pressed="kind === tab"
              @click="selectKind(tab)"
            >
              {{ { species: '精灵', skill: '技能', mark: '印记' }[tab] }}（{{ draft.data[collection[tab]].length }}）
            </button>
          </div>
          <div class="fields">
            <label>本地 ID<input v-model="localId" placeholder="ice_strike 或 skills/ice_strike" /></label
            ><label
              >初始内容<select v-model="copyId" aria-label="初始内容">
                <option value="">空白内容</option>
                <option v-for="item in base[collection[kind]] as WorkRecord[]" :key="item.id" :value="item.id">
                  复制 {{ item.id }}
                </option>
              </select></label
            ><button @click="run(add)">添加内容</button>
          </div>
          <label
            >编辑内容<select v-model="activeId" aria-label="编辑内容">
              <option value="">请选择</option>
              <option v-for="item in records" :key="item.id" :value="item.id">
                {{ item.name ?? item.id }} · {{ draft.project.namespace }}:{{ item.id }}
              </option>
            </select></label
          >
          <article v-if="record">
            <h3>
              <code>{{ draft.project.namespace }}:{{ record.id }}</code>
            </h3>
            <label>显示名称<input :value="field('name')" @input="set('name', text($event))" /></label>
            <div v-if="kind !== 'mark'" class="fields">
              <label
                >属性<select :value="field('element')" @change="set('element', text($event))">
                  <option v-for="element in Object.values(Element)" :key="element">{{ element }}</option>
                </select></label
              >
              <template v-if="kind === 'skill'"
                ><label
                  >类别<select :value="field('category')" @change="set('category', text($event))">
                    <option>Physical</option>
                    <option>Special</option>
                    <option>Status</option>
                  </select></label
                ><label
                  v-for="(label, key) in { power: '威力', rage: '怒气消耗', accuracy: '命中率', priority: '优先级' }"
                  :key="key"
                  >{{ label }}<input type="number" :value="field(key)" @input="set(key, Number(text($event)))" /></label
              ></template>
              <template v-else
                ><label
                  >外观编号<input
                    type="number"
                    :value="field('num')"
                    @input="set('num', Number(text($event)))" /></label
                ><label
                  v-for="(label, key) in {
                    hp: '生命',
                    atk: '物攻',
                    def: '物防',
                    spa: '特攻',
                    spd: '特防',
                    spe: '速度',
                  }"
                  :key="key"
                  >{{ label }}种族值<input
                    type="number"
                    :value="fields('baseStats')[key]"
                    @input="setNested('baseStats', key, Number(text($event)))" /></label
              ></template>
            </div>
            <div v-if="kind === 'mark'" class="fields">
              <label
                >持续回合（-1 为无限）<input
                  type="number"
                  :value="fields('config').duration"
                  @input="setNested('config', 'duration', Number(text($event)))" /></label
              ><label
                >最多层数<input
                  type="number"
                  :value="fields('config').maxStacks"
                  @input="setNested('config', 'maxStacks', Number(text($event)))" /></label
              ><label
                ><input
                  type="checkbox"
                  :checked="Boolean(fields('config').stackable)"
                  @change="setNested('config', 'stackable', ($event.target as HTMLInputElement).checked)"
                />允许叠层</label
              >
            </div>
            <template v-if="kind === 'species'"
              ><label
                >可学技能（可多选）<select
                  multiple
                  aria-label="可学技能（可多选）"
                  size="6"
                  :value="
                    array('learnable_skills').map(item =>
                      JSON.stringify(item && typeof item === 'object' && !Array.isArray(item) ? item.skill_id : null),
                    )
                  "
                  @change="
                    set(
                      'learnable_skills',
                      selectLearnableSkills(
                        array('learnable_skills'),
                        Array.from(($event.target as HTMLSelectElement).selectedOptions).map(option =>
                          JSON.parse(option.value),
                        ),
                      ),
                    )
                  "
                >
                  <option
                    v-for="option in skills"
                    :key="JSON.stringify(option.value)"
                    :value="JSON.stringify(option.value)"
                  >
                    {{ option.label }}
                  </option>
                </select></label
              ><label v-for="slot in ['ability', 'emblem'] as const" :key="slot"
                >{{ slot === 'ability' ? '特性' : '纹章'
                }}<select
                  multiple
                  size="3"
                  :value="array(slot).map(item => JSON.stringify(item))"
                  @change="
                    set(
                      slot,
                      Array.from(($event.target as HTMLSelectElement).selectedOptions).map(option =>
                        JSON.parse(option.value),
                      ),
                    )
                  "
                >
                  <option
                    v-for="option in marks"
                    :key="JSON.stringify(option.value)"
                    :value="JSON.stringify(option.value)"
                  >
                    {{ option.label }}
                  </option>
                </select></label
              ></template
            >
            <BehaviorEditor
              v-else
              :value="field('behaviors')"
              :kind="kind"
              :references="{ mark: marks, skill: skills }"
              @change="set('behaviors', $event)"
            />
            <p v-if="array('effect').length" class="help">
              保留的官方效果：{{ array('effect').join('、') }}。这些效果使用官方实现和原有引用。
            </p>
            <button class="remove" @click="removeRecord">移除此内容</button>
          </article>
          <details>
            <summary>引用其他作品</summary>
            <label
              v-for="(release, key) in workspace.releases"
              v-show="release.project.id !== draft.project.id"
              :key="key"
              ><input
                type="checkbox"
                :checked="
                  draft.dependencies.some(dep => dep.projectId === release.project.id && dep.digest === release.digest)
                "
                @change="setDependency(key, ($event.target as HTMLInputElement).checked)"
              />{{ release.project.title }} · {{ release.project.namespace }} · {{ release.releaseVersion }}</label
            >
            <p class="help">依赖锁定到所选版本；对方更新作品不会改变本作。</p>
          </details>
          <div class="toolbar">
            <label>固定版本号<input v-model="releaseVersion" placeholder="1.0.0" /></label
            ><button @click="run(publish)">创建固定版本</button>
          </div>
          <TrialBattle
            v-if="preview"
            :key="preview.selection.selected[0].digest"
            :selection="preview.selection"
            :species="preview.species"
          />
        </section>
        <section v-else class="panel">
          <h2>从一份作品开始</h2>
          <p>在左侧创建作品或导入好友分享的文件。未完成的内容可以保存为草稿，发布和试战前会检查引用及效果参数。</p>
        </section>
      </div>
      <section class="panel releases">
        <h2>已安装的固定版本</h2>
        <p>启用的版本将加入试战环境；导出的组合可在其他客户端及命令行中加载。</p>
        <button :disabled="!workspace.selected.length" @click="run(() => download('selection'))">导出启用组合</button>
        <p v-if="!installed.length">暂无。创建固定版本后，即可导出作品及其依赖。</p>
        <div v-for="(release, key) in workspace.releases" :key="key" class="release-row">
          <span>{{ release.project.title }} · {{ release.project.namespace }} · {{ release.releaseVersion }}</span
          ><button @click="run(() => toggle(key))">
            {{
              workspace.selected.some(item => item.projectId === release.project.id && item.digest === release.digest)
                ? '停用'
                : '启用'
            }}</button
          ><button @click="run(() => download('release', key))">导出此版本</button>
        </div>
      </section>
    </fieldset>
  </main>
</template>
<style>
.creator {
  width: 100%;
  min-height: 100%;
  background: #101923;
  padding: 28px 20px 60px;
  color: #e7edf5;
}
.creator > header,
.creator > fieldset,
.creator > .error,
.creator > .notice {
  max-width: 1240px;
  margin-left: auto;
  margin-right: auto;
}
.creator header {
  margin-bottom: 24px;
}
.creator h1 {
  font-size: 30px;
  font-weight: 700;
}
.creator h2 {
  font-size: 21px;
  font-weight: 650;
  margin-bottom: 14px;
}
.creator h3 {
  font-size: 17px;
  font-weight: 600;
  margin: 20px 0 10px;
}
.creator p {
  margin: 8px 0 14px;
  line-height: 1.6;
  color: #b8c6d8;
}
.creator fieldset {
  border: 0;
  padding: 0;
  min-width: 0;
}
.creator-layout {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
.creator .panel {
  background: #182231;
  border: 1px solid #354258;
  padding: 22px;
  border-radius: 14px;
  min-width: 0;
}
.creator label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 14px;
  margin: 12px 0;
  min-width: 0;
}
.creator input,
.creator select,
.creator textarea {
  padding: 9px;
  background: #101923;
  border: 1px solid #51617a;
  border-radius: 6px;
  color: #f3f5f9;
  width: 100%;
  min-width: 0;
}
.creator input[type='checkbox'] {
  width: 18px;
  height: 18px;
}
.creator button {
  background: #263a51;
  color: #edf5ff;
  padding: 8px 12px;
  border: 1px solid #55718e;
  border-radius: 6px;
  cursor: pointer;
  margin: 3px;
  font-size: 14px;
}
.creator button:hover {
  background: #3c5674;
}
.creator button[aria-pressed='true'] {
  border-color: #7cd1ff;
  background: #285170;
}
.creator button:disabled,
.creator fieldset:disabled button {
  opacity: 0.5;
  cursor: default;
}
.creator :focus-visible {
  outline: 2px solid #95dbff;
  outline-offset: 3px;
}
.creator .toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.creator .fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 12px;
  align-items: end;
}
.creator .help {
  font-size: 12px;
}
.creator .work-item {
  display: block;
  width: 100%;
  text-align: left;
  margin: 8px 0;
}
.creator small {
  display: block;
  color: #b8c6d8;
}
.creator .effect-card {
  background: #111b28;
  padding: 16px;
  margin: 14px 0;
  border-radius: 8px;
  border: 1px solid #354258;
}
.creator .error {
  background: #512b33;
  color: #ffd7dc;
  padding: 16px;
  overflow-wrap: anywhere;
}
.creator .notice {
  background: #21433d;
  color: #b8f0d7;
  padding: 12px;
}
.creator .releases {
  margin-top: 20px;
}
.creator .release-row {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  margin: 10px 0;
}
.creator code {
  overflow-wrap: anywhere;
}
.creator .trial {
  margin-top: 20px;
  border-top: 1px solid #51617a;
}
.creator .remove {
  margin-top: 16px;
  color: #ffd4c7;
}
@media (max-width: 760px) {
  .creator-layout {
    grid-template-columns: 1fr;
  }
  .creator {
    padding: 16px 10px;
  }
  .creator .panel {
    padding: 16px;
  }
}
</style>
