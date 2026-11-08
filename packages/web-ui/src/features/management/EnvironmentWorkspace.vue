<script setup lang="ts">
import './managementStyles'
import { ElTable, ElTableColumn, ElButton, ElForm, ElFormItem, ElInput, ElCheckbox } from 'element-plus'
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
  packageState: [environment: ManagedEnvironment, name: string, enabled: boolean, cascade: boolean]
  save: [document: ManagedEnvironmentDocument, expectedRevision: string | null]
  prepare: [environment: ManagedEnvironment]
  use: [version: ManagedEnvironmentVersion, executionPolicy?: 'server' | 'peer']
  delete: [version: ManagedEnvironmentVersion]
  references: [version: ManagedEnvironmentVersion]
  deleteDraft: [environment: ManagedEnvironment]
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
const detailTab = ref<'packages' | 'versions'>('packages')
const selectedEnvironment = computed(
  () => props.environments.find(item => item.document.id === selectedId.value) ?? props.environments[0],
)
const latestVersion = computed(
  () =>
    props.versions
      .filter(item => item.environmentId === selectedEnvironment.value?.document.id && item.status === 'ready')
      .sort((a, b) => (b.status === 'ready' ? b.createdAt : 0) - (a.status === 'ready' ? a.createdAt : 0))[0],
)
const deletingVersion = ref('')
const deletingDraft = ref('')
const disablingPackage = ref('')
function changePackage(name: string, enabled: boolean, cascade = false) {
  if (!selectedEnvironment.value) return
  disablingPackage.value = ''
  emit('packageState', selectedEnvironment.value, name, enabled, cascade)
}
function duplicate(environment: ManagedEnvironment) {
  edit(environment)
  revision.value = null
  document.value!.id = `${environment.document.id.slice(0, 60)}-copy-${crypto.randomUUID().slice(0, 6)}`
  document.value!.name += ' 副本'
}
function deleteVersion(version: ManagedEnvironmentVersion) {
  deletingVersion.value = ''
  emit('delete', version)
}
function deleteDraft(environment: ManagedEnvironment) {
  deletingDraft.value = ''
  emit('deleteDraft', environment)
}
function selectEnvironment(environment: ManagedEnvironment) {
  selectedId.value = environment.document.id
  editing.value = false
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
  props.versions.filter(version => version.environmentId === selectedEnvironment.value?.document.id),
)
const clone = (value: ManagedEnvironmentDocument): ManagedEnvironmentDocument => JSON.parse(JSON.stringify(value))

function edit(environment?: ManagedEnvironment) {
  if (environment) selectedId.value = environment.document.id
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
      <ElButton
        :disabled="!canEdit || busy"
        :title="!canEdit ? '没有编辑此工作区的权限' : undefined"
        @click="edit()"
        native-type="button"
      >
        新建环境
      </ElButton>
    </header>
    <p v-if="!canEdit" class="hint">你可以查看此工作区；编辑与准备需要相应授权。</p>
    <div class="workspace-columns">
      <nav class="environment-list" aria-label="选择环境">
        <ElButton
          v-for="environment in environments"
          :key="environment.document.id"
          :aria-current="selectedEnvironment?.document.id === environment.document.id ? 'true' : undefined"
          @click="selectEnvironment(environment)"
          native-type="button"
        >
          <strong>{{ environment.document.name }}</strong>
          <small
            >{{
              Object.keys(environment.document.packages).length + environment.document.sources.length
            }}
            个直接添加的包</small
          >
        </ElButton>
        <p v-if="!environments.length" class="hint">还没有环境。新建一个组合开始。</p>
      </nav>
      <div class="environment-detail">
        <template v-if="selectedEnvironment && !editing">
          <header class="section-heading">
            <div>
              <h3>{{ selectedEnvironment.document.name }}</h3>
              <small>保存草稿 → 准备固定版本 → 使用或发布</small>
            </div>
            <div class="actions">
              <ElButton :disabled="!canEdit || busy" @click="edit(selectedEnvironment)" native-type="button"
                >编辑</ElButton
              >
              <ElButton :disabled="!canEdit || busy" @click="duplicate(selectedEnvironment)" native-type="button"
                >复制环境</ElButton
              >
              <ElButton
                v-if="canDelete"
                :disabled="busy"
                @click="deletingDraft = selectedEnvironment.document.id"
                native-type="button"
              >
                删除环境
              </ElButton>
            </div>
          </header>
          <div v-if="deletingDraft === selectedEnvironment.document.id" role="group" aria-label="删除环境确认">
            <p>删除草稿前需先移除其固定版本与服务器引用。</p>
            <ElButton :disabled="busy" @click="deleteDraft(selectedEnvironment)" native-type="button"
              >确认删除环境</ElButton
            >
            <ElButton @click="deletingDraft = ''" native-type="button">取消</ElButton>
          </div>
          <nav class="actions" aria-label="环境详情">
            <ElButton @click="detailTab = 'packages'" :aria-pressed="detailTab === 'packages'" native-type="button"
              >资源包</ElButton
            >
            <ElButton @click="detailTab = 'versions'" :aria-pressed="detailTab === 'versions'" native-type="button"
              >固定版本</ElButton
            >
          </nav>
          <section v-if="detailTab === 'packages'" class="members">
            <template
              v-if="latestVersion?.status !== 'ready' || latestVersion.draftRevision !== selectedEnvironment.revision"
            >
              <h4>草稿中的直接依赖</h4>
              <ul class="package-list">
                <li v-for="(range, name) in selectedEnvironment.document.packages" :key="name">
                  <strong>{{ name }}</strong>
                  <span>{{ range }}</span>
                </li>
                <li v-for="name in selectedEnvironment.document.sources" :key="name">{{ name }} · 已登记来源</li>
              </ul>
            </template>
            <template v-if="latestVersion?.status === 'ready' && latestVersion.members">
              <h4>最近固定版本的完整资源包列表</h4>
              <p v-if="latestVersion.draftRevision !== selectedEnvironment.revision" class="hint">
                草稿已更改，以下是上次成功准备的结果。
              </p>
              <article v-for="member in latestVersion.members" :key="member.name" class="member">
                <strong>{{ member.name }}</strong>
                <span>{{ member.version }} · {{ member.direct ? '直接添加' : '自动依赖' }}</span>
                <small v-if="member.requiredBy.length">被依赖：{{ member.requiredBy.join('、') }}</small>
                <small v-if="member.dependencies.length">需要：{{ member.dependencies.join('、') }}</small>
                <small v-if="selectedEnvironment.requiredPackages?.includes(member.name)">默认环境必需</small>
                <ElButton
                  v-else
                  :disabled="busy || !canEdit"
                  @click="disablingPackage = member.name"
                  native-type="button"
                  >停用</ElButton
                >
                <div v-if="disablingPackage === member.name" role="group" aria-label="停用资源包确认">
                  <p>
                    停用会修改草稿，已准备版本保持不变。{{
                      member.requiredBy.length ? '其他包依赖它，可以选择连带停用。' : ''
                    }}
                  </p>
                  <ElButton :disabled="busy || !canEdit" @click="changePackage(member.name, false)" native-type="button"
                    >确认停用</ElButton
                  >
                  <ElButton
                    v-if="member.requiredBy.length"
                    :disabled="busy || !canEdit"
                    @click="changePackage(member.name, false, true)"
                    native-type="button"
                  >
                    连带停用依赖它的包
                  </ElButton>
                  <ElButton @click="disablingPackage = ''" native-type="button">取消</ElButton>
                </div>
              </article>
              <p v-if="!latestVersion.members.length" class="hint">此版本没有额外资源包。</p>
            </template>
            <p v-else class="hint">准备版本后显示自动依赖与实际版本。每个资源包只允许一个版本，冲突时保留已有版本。</p>
            <template v-if="selectedEnvironment.document.disabled">
              <h4>已停用的直接依赖</h4>
              <article
                v-for="(range, name) in selectedEnvironment.document.disabled.packages"
                :key="name"
                class="member"
              >
                {{ name }} · {{ range }}
                <ElButton :disabled="busy || !canEdit" @click="changePackage(String(name), true)" native-type="button"
                  >启用</ElButton
                >
              </article>
              <article v-for="name in selectedEnvironment.document.disabled.sources" :key="name" class="member">
                {{ name }} · 已登记来源
                <ElButton :disabled="busy || !canEdit" @click="changePackage(name, true)" native-type="button"
                  >启用</ElButton
                >
              </article>
            </template>
          </section>
        </template>
        <ElForm
          v-if="editing && document"
          class="environment-editor"
          aria-label="编辑环境"
          @submit.prevent="save"
          label-position="top"
        >
          <h3>{{ revision === null ? '新建环境' : '编辑环境' }}</h3>
          <p v-if="validation" role="alert" class="error">{{ validation }}</p>
          <div class="field-row">
            <ElFormItem label="名称">
              <ElInput v-model="document.name" required maxlength="80" />
            </ElFormItem>
            <ElFormItem label="标识">
              <ElInput
                v-model="document.id"
                required
                pattern="[a-z0-9][a-z0-9_\-]{0,79}"
                :disabled="revision !== null"
                placeholder="friends"
              />
            </ElFormItem>
          </div>
          <fieldset>
            <legend>直接依赖</legend>
            <div v-for="(row, index) in packageRows" :key="index" class="package-row">
              <ElFormItem label="包名">
                <ElInput
                  v-model="row.name"
                  :readonly="!!revision && selectedEnvironment?.requiredPackages?.includes(row.name)"
                  placeholder="@author/package"
                  required
                />
              </ElFormItem>
              <ElFormItem label="版本范围">
                <ElInput v-model="row.version" aria-label="版本范围" placeholder="^1.0.0 或 >=1.5 <2" required>
                </ElInput>
              </ElFormItem>
              <ElButton
                v-if="!revision || !selectedEnvironment?.requiredPackages?.includes(row.name)"
                @click="packageRows.splice(index, 1)"
                native-type="button"
              >
                移除
              </ElButton>
            </div>
            <ElButton @click="packageRows.push({ name: '', version: '' })" native-type="button">添加内容包</ElButton>
          </fieldset>
          <details>
            <summary>来源与规则</summary>
            <ElFormItem label="已登记的来源包名（每行一个）">
              <ElInput v-model="sourceText" :rows="3" type="textarea" />
            </ElFormItem>
            <ElFormItem label="环境分级">
              <ElInput
                :model-value="document.rules.tier ?? ''"
                @input="document.rules.tier = $event || undefined"
                placeholder="可选"
              />
            </ElFormItem>
            <div class="field-row">
              <ElFormItem label="队伍最少数量">
                <ElInput
                  type="number"
                  min="1"
                  max="100"
                  :model-value="document.rules.team?.minSize"
                  @input="setTeamSize('minSize', $event)"
                />
              </ElFormItem>
              <ElFormItem label="队伍最多数量">
                <ElInput
                  type="number"
                  min="1"
                  max="100"
                  :model-value="document.rules.team?.maxSize"
                  @input="setTeamSize('maxSize', $event)"
                />
              </ElFormItem>
            </div>
            <ElCheckbox
              :model-value="document.rules.team?.uniqueSpecies"
              @change="
                document.rules.team = {
                  ...document.rules.team,
                  uniqueSpecies: Boolean($event),
                }
              "
              >队伍内精灵不重复</ElCheckbox
            >
            <fieldset v-for="side in ['allow', 'deny'] as const" :key="side">
              <legend>{{ side === 'allow' ? '允许内容（留空表示不额外限制）' : '禁止内容' }}</legend>
              <ElFormItem
                v-for="kind in contentKinds"
                :key="kind"
                :label="String(contentLabels[kind]) + '标识（每行一个）'"
              >
                <ElInput
                  :model-value="document.rules[side]?.[kind]?.join('\n') ?? ''"
                  :rows="2"
                  @input="setRuleList(side, kind, $event)"
                  type="textarea"
                />
              </ElFormItem>
            </fieldset>
            <p class="hint">规则随准备的版本固定，已有兼容要求随本次保存保留。来源须先由宿主登记。</p>
          </details>
          <div class="actions">
            <ElButton class="primary" :disabled="busy || !canEdit" native-type="submit" type="primary"
              >保存环境</ElButton
            >
            <ElButton @click="editing = false" native-type="button">关闭编辑</ElButton>
          </div>
          <p class="hint">保存不会改变已发布版本。发生版本冲突时，你的编辑内容会留在这里。</p>
        </ElForm>
        <template v-if="!editing && detailTab === 'versions'">
          <header class="section-heading">
            <h3>固定版本</h3>
          </header>
          <div class="table-wrap">
            <ElTable :data="selectedVersions" row-key="versionId" stripe empty-text="暂无符合条件的记录">
              <ElTableColumn label="环境" min-width="180">
                <template #default="{ row: version }">{{
                  version.status === 'ready' ? version.document.name : (version.environmentId ?? '未知环境')
                }}</template>
              </ElTableColumn>
              <ElTableColumn label="版本" min-width="150">
                <template #default="{ row: version }">
                  <code :title="version.versionId">{{ version.versionId.slice(0, 16) }}</code>
                  <small v-if="version.status === 'ready'">{{ new Date(version.createdAt).toLocaleString() }}</small>
                </template>
              </ElTableColumn>
              <ElTableColumn label="状态" min-width="150">
                <template #default="{ row: version }"
                  >{{ version.status === 'ready' ? '已准备' : '材料不可用'
                  }}<small v-if="version.status === 'unavailable'">{{ version.reason }}</small>
                </template>
              </ElTableColumn>
              <ElTableColumn label="操作" min-width="240">
                <template #default="{ row: version }">
                  <ElButton :disabled="busy" @click="emit('references', version)" native-type="button"
                    >查看引用</ElButton
                  >
                  <ElButton
                    :disabled="busy || version.status !== 'ready' || !canUse"
                    :title="!canUse ? '需要工作区使用和服务器绑定管理权限' : undefined"
                    @click="emit('use', version)"
                    native-type="button"
                  >
                    用于服务器
                  </ElButton>
                  <ElButton
                    :disabled="busy || version.status !== 'ready' || !canUse"
                    :title="!canUse ? '需要工作区使用和服务器绑定管理权限' : undefined"
                    @click="emit('use', version, 'peer')"
                    native-type="button"
                  >
                    用于玩家托管
                  </ElButton>
                  <ElButton
                    v-if="canDelete && deletingVersion !== version.versionId"
                    :disabled="busy"
                    @click="deletingVersion = version.versionId"
                    native-type="button"
                  >
                    删除版本
                  </ElButton>
                  <span v-if="deletingVersion === version.versionId">
                    <ElButton :disabled="busy" @click="deleteVersion(version)" native-type="button">确认删除</ElButton>
                    <ElButton @click="deletingVersion = ''" native-type="button">取消</ElButton>
                  </span>
                </template>
              </ElTableColumn>
            </ElTable>
          </div>
        </template>
        <footer v-if="selectedEnvironment && !editing" class="workspace-footer">
          <span class="hint">准备不会自动启用或发布。</span>
          <ElButton
            class="primary"
            :disabled="!canPrepare || busy"
            @click="emit('prepare', selectedEnvironment)"
            native-type="button"
            type="primary"
          >
            准备版本
          </ElButton>
        </footer>
      </div>
    </div>
  </section>
</template>

<style scoped>
.environment-workspace {
  display: flex;
  flex-direction: column;
}
.workspace-columns {
  display: grid;
  grid-template-columns: minmax(170px, 25%) minmax(0, 1fr);
  flex: 1;
  min-height: 0;
  border: 1px solid var(--el-border-color-light);
  border-radius: 12px;
  overflow: hidden;
}
.environment-list {
  overflow: auto;
  padding: 12px;
  border-right: 1px solid var(--el-border-color-light);
  background: var(--el-fill-color-light);
}
.environment-list :deep(.el-button > span) {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  white-space: normal;
}
.environment-list button {
  height: auto;
  padding: 12px;
  margin-left: 0;
  display: block;
  width: 100%;
  text-align: left;
  margin-bottom: 8px;
  overflow-wrap: anywhere;
}
.environment-list button[aria-current='true'] {
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary);
}
.environment-detail {
  overflow: auto;
  padding: 0 20px;
  min-width: 0;
}
.environment-detail .section-heading {
  margin: 16px 0 12px;
}
.members h4 {
  margin: 12px 0 8px;
}
.member {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 2px 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--el-border-color-light);
  overflow-wrap: anywhere;
}
.member > strong,
.member > span,
.member > small {
  grid-column: 1;
}
.member > button {
  grid-column: 2;
  grid-row: 1 / 4;
  align-self: center;
}
.member > div {
  grid-column: 1 / -1;
}
.member > small {
  margin-top: 0;
}
.member > span {
  font-size: 0.85rem;
  display: block;
  color: var(--el-text-color-secondary);
}
.workspace-footer {
  position: sticky;
  bottom: 0;
  background: var(--el-bg-color);
  padding: 12px 0;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  border-top: 1px solid var(--el-border-color-light);
}
@media (max-width: 600px) {
  .workspace-columns {
    grid-template-columns: minmax(0, 1fr);
  }
  .environment-list {
    display: flex;
    gap: 8px;
    max-height: 180px;
    border-right: 0;
    border-bottom: 1px solid var(--el-border-color-light);
  }
  .environment-detail {
    padding: 0 10px;
  }
  .workspace-footer {
    flex-wrap: wrap;
  }
}

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
  color: var(--el-text-color-secondary);
  font-size: 0.9rem;
}
.environment-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 1rem;
}
.environment-card,
.environment-editor {
  border: 1px solid var(--el-border-color-light);
  border-radius: 12px;
  padding: 1rem;
  background: var(--el-bg-color);
}
.environment-card h3 {
  margin: 0;
}
.environment-card p {
  color: var(--el-text-color-secondary);
  font-size: 0.9rem;
}
.package-list {
  padding-left: 1rem;
  font-size: 0.85rem;
  overflow-wrap: anywhere;
}
.package-list span {
  color: var(--el-text-color-secondary);
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
.field-row > .el-form-item,
.package-row > .el-form-item {
  flex: 1;
  min-width: 140px;
}
fieldset {
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  margin: 1rem 0;
}
.table-wrap {
  overflow: auto;
}
small {
  display: block;
  color: var(--el-text-color-secondary);
  margin-top: 0.25rem;
}
.error {
  color: var(--el-color-danger);
}
details {
  margin: 1rem 0;
}
summary {
  cursor: pointer;
}
</style>
