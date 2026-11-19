<script setup lang="ts">
import type {
  EnvironmentExportPreview,
  EnvironmentExportSelection,
} from '@arcadia-eternity/content-sdk/management-workspace'
import EnvironmentExportButton from './EnvironmentExportButton.vue'
import EnvironmentReferenceInput from './EnvironmentReferenceInput.vue'
import EnvironmentBooleanField from './EnvironmentBooleanField.vue'
import EnvironmentIdList from './EnvironmentIdList.vue'
import { resolveDraftContent, rulePreviewIssue, type EditorPackage } from './environmentRuleCatalog'
import { environmentReferences } from './environmentReferences'
import { environmentName } from '@/i18n/environment'
import './managementStyles'
import testEnvironmentRules from '@arcadia-eternity/data-pack-base/environment/test-120-rules.json'
import {
  assertRuleContentReferences,
  indexRuleContent,
  prepareEnvironmentRules,
  resolveEnvironmentMechanics,
  validateEnvironmentRuleDeclaration,
} from '@arcadia-eternity/content-sdk/environment-rules'
import { resolveEnvironmentTeam, skillSlotsSchema } from '@arcadia-eternity/const'
import EnvironmentContentLimits from './EnvironmentContentLimits.vue'
import EnvironmentConstraintFields from './EnvironmentConstraintFields.vue'
import EnvironmentSkillParameterFields from './EnvironmentSkillParameterFields.vue'
import EnvironmentMatchupFields from './EnvironmentMatchupFields.vue'
import EnvironmentLearningFields from './EnvironmentLearningFields.vue'
import { registerEnvironmentDraft, discardEnvironmentChanges } from '@/features/content/unsavedEnvironment'
import {
  ElAlert,
  ElButton,
  ElCard,
  ElScrollbar,
  ElInputNumber,
  ElForm,
  ElFormItem,
  ElInput,
  ElTabs,
  ElTabPane,
  ElSelect,
  ElOption,
} from 'element-plus'
import { computed, nextTick, ref, watch } from 'vue'
import type { ManagedEnvironment, ManagedEnvironmentDocument, ManagedEnvironmentInstallation } from '@/types/management'

const props = withDefaults(
  defineProps<{
    availablePackages?: EditorPackage[]
    packageEnvironmentId?: string
    pendingPackage?: { id: string; name: string; version: string }
    heading?: string
    environments: ManagedEnvironment[]
    installations: ManagedEnvironmentInstallation[]
    canEdit: boolean
    canPrepare: boolean
    previewExport?: (id: string) => Promise<EnvironmentExportPreview>
    canExport?: boolean
    canDelete?: boolean
    canUse?: boolean
    showUseActions?: boolean
    useLabel?: string
    showPeerUse?: boolean
    currentEnvironmentId?: string
    saveSequence?: number
    busy: boolean
  }>(),
  { showUseActions: true, showPeerUse: true, useLabel: '服务器使用' },
)
const emit = defineEmits<{
  packageAccepted: []
  removePackage: [environment: ManagedEnvironment, name: string, cascade: boolean]
  save: [document: ManagedEnvironmentDocument, expectedRevision: string | null, copyFrom?: string]
  use: [version: ManagedEnvironmentInstallation, executionPolicy?: 'server' | 'peer']
  export: [version: ManagedEnvironmentInstallation, selection: EnvironmentExportSelection]
  delete: [version: ManagedEnvironmentInstallation]
  references: [version: ManagedEnvironmentInstallation]
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
const activeTab = ref('packages')
const editorSession = ref(0)
const editingFromId = ref<string>()
const packageList = ref<HTMLElement>()
const validatePackages = ref(false)
function packageIssue(index: number, field: 'name' | 'version') {
  if (!validatePackages.value) return ''
  const value = packageRows.value[index]?.[field].trim()
  if (!value) return field === 'name' ? '请填写包名' : '请填写版本范围'
  if (field === 'name' && packageRows.value.slice(0, index).some(row => row.name.trim() === value)) return '包名重复'
  return ''
}
async function focusPackage(index: number, field: 'name' | 'version') {
  activeTab.value = 'packages'
  await nextTick()
  const row = packageList.value?.querySelectorAll('.package-row')[index]
  row?.querySelector<HTMLInputElement>(`.${field}-field input`)?.focus()
}
function addPackageRow() {
  packageRows.value.push({ name: '', version: '' })
  void focusPackage(packageRows.value.length - 1, 'name')
}
const originalDraft = ref('')
const draftValue = () => JSON.stringify({ document: document.value, packages: packageRows.value })
const dirty = computed(() => editing.value && draftValue() !== originalDraft.value)
registerEnvironmentDraft(() => dirty.value)
async function closeEditor() {
  if (!dirty.value || (await discardEnvironmentChanges())) editing.value = false
}
const selectedId = ref('')
const selectedEnvironment = computed(
  () => props.environments.find(item => item.document.id === selectedId.value) ?? props.environments[0],
)
const latestVersion = computed(
  () =>
    props.installations
      .filter(item => item.environmentId === selectedEnvironment.value?.document.id && item.status === 'ready')
      .sort((a, b) => (b.status === 'ready' ? b.createdAt : 0) - (a.status === 'ready' ? a.createdAt : 0))[0],
)
const draftContent = computed(() => {
  const installed = latestVersion.value
  return resolveDraftContent({
    rows: packageRows.value,
    sources: document.value?.sources ?? [],
    materials: props.availablePackages ?? [],
    installations: props.installations,
    origin: installed?.status === 'ready' && installed.environmentId === editingFromId.value ? installed : undefined,
    draft: props.environments.find(item => item.document.id === editingFromId.value),
  })
})
const matchingInstallation = computed(() => draftContent.value.installation)
const previewCatalog = computed(() => draftContent.value.catalog)
const ruleSets = computed(() => draftContent.value.ruleSets)
function previewRules(rules: ManagedEnvironmentDocument['rules']) {
  try {
    return { value: prepareEnvironmentRules(rules, ruleSets.value) }
  } catch (error) {
    return { issue: rulePreviewIssue(error) }
  }
}
const previewComposition = computed(() => document.value && previewRules(document.value.rules))
const inheritance = computed(() => {
  const include = document.value?.rules.include
  return include?.length ? previewRules({ schemaVersion: 2, include }) : undefined
})
const inheritedRules = computed(() => inheritance.value?.value?.rules)
const inheritanceKnown = computed(() => !document.value?.rules.include?.length || !!inheritedRules.value)
const inheritedMechanics = computed(() =>
  inheritanceKnown.value ? resolveEnvironmentMechanics(inheritedRules.value) : undefined,
)
const effectiveMechanics = computed(
  () => previewComposition.value?.value && resolveEnvironmentMechanics(previewComposition.value.value.rules),
)
const resolvedRules = computed(() => previewComposition.value?.value?.rules)
const effectiveTeam = computed(() => resolvedRules.value && resolveEnvironmentTeam(resolvedRules.value))
const inheritedTeam = computed(() =>
  inheritanceKnown.value ? resolveEnvironmentTeam(inheritedRules.value) : undefined,
)
const contentIndex = computed(() => {
  const catalog = previewCatalog.value?.contentCatalog
  return catalog && indexRuleContent({ ...catalog, enhancements: catalog.stages })
})
const ruleIssue = computed(() => {
  const preview = previewComposition.value
  if (!preview?.value || !contentIndex.value) return preview?.issue
  try {
    assertRuleContentReferences(preview.value.rules, contentIndex.value, preview.value.fields)
    return undefined
  } catch (error) {
    return rulePreviewIssue(error)
  }
})
function inheritMechanic(key: 'individualValues' | 'individualValueDefault' | 'allowFaintSwitch') {
  if (!document.value?.rules.mechanics) return
  delete document.value.rules.mechanics[key]
  if (!Object.keys(document.value.rules.mechanics).length) delete document.value.rules.mechanics
}
const deletingDraft = ref('')
const removingPackage = ref('')
function removePackage(name: string, cascade = false) {
  if (!selectedEnvironment.value) return
  removingPackage.value = ''
  emit('removePackage', selectedEnvironment.value, name, cascade)
}
async function duplicate(environment: ManagedEnvironment) {
  if (!(await edit(environment))) return
  revision.value = null
  document.value!.id = `${environment.document.id.slice(0, 60)}-copy-${crypto.randomUUID().slice(0, 6)}`
  document.value!.name += ' 副本'
}
function deleteDraft(environment: ManagedEnvironment) {
  if (environment.builtin) return
  deletingDraft.value = ''
  emit('deleteDraft', environment)
}
async function selectEnvironment(environment: ManagedEnvironment) {
  if (dirty.value && !(await discardEnvironmentChanges())) return
  selectedId.value = environment.document.id
  editing.value = false
}
const packageOptions = computed(() =>
  [
    ...new Set([
      ...(props.availablePackages ?? []).map(pkg => pkg.name),
      ...props.environments.flatMap(env => [...Object.keys(env.document.packages), ...env.document.sources]),
    ]),
  ]
    .sort()
    .map(name => ({ value: name, label: name })),
)
const referenceOptions = computed(() =>
  environmentReferences(
    draftContent.value.packages,
    props.availablePackages ?? [],
    props.installations,
    previewCatalog.value,
  ),
)
function setRuleSets(include: string[]) {
  if (!document.value) return
  if (include.length) document.value.rules = { ...document.value.rules, schemaVersion: 2, include }
  else delete document.value.rules.include
}
function setMechanics(change: NonNullable<ManagedEnvironmentDocument['rules']['mechanics']>) {
  if (!document.value) return
  document.value.rules = {
    ...document.value.rules,
    schemaVersion: 2,
    mechanics: { ...document.value.rules.mechanics, ...change },
  }
}
function inheritTeamField(key: 'minSize' | 'maxSize' | 'uniqueSpecies') {
  if (!document.value?.rules.team) return
  delete document.value.rules.team[key]
  if (!Object.keys(document.value.rules.team).length) delete document.value.rules.team
}
function setUniqueSpecies(value?: boolean) {
  if (!document.value) return
  if (value === undefined) inheritTeamField('uniqueSpecies')
  else document.value.rules.team = { ...document.value.rules.team, uniqueSpecies: value }
}
function setTeamSize(key: 'minSize' | 'maxSize', value: number | null | undefined) {
  if (!document.value) return
  if (value == null) inheritTeamField(key)
  else document.value.rules.team = { ...document.value.rules.team, [key]: value }
}
const clone = (value: ManagedEnvironmentDocument): ManagedEnvironmentDocument => JSON.parse(JSON.stringify(value))

async function edit(environment?: ManagedEnvironment) {
  if (dirty.value && !(await discardEnvironmentChanges())) return false
  if (environment) selectedId.value = environment.document.id
  editingFromId.value = environment?.document.id
  revision.value = environment?.revision ?? null
  document.value = environment
    ? clone(environment.document)
    : { schemaVersion: 2, id: '', name: '', packages: {}, sources: [], rules: { schemaVersion: 1 }, requires: {} }
  packageRows.value = Object.entries(document.value.packages).map(([name, version]) => ({ name, version }))
  editorSession.value++
  activeTab.value = 'packages'
  validatePackages.value = false
  originalDraft.value = draftValue()
  editing.value = true
  return true
}
async function createTestEnvironment() {
  if (!(await edit())) return
  const base = '@arcadia-eternity/data-pack-base'
  const version =
    props.availablePackages?.find(pkg => pkg.name === base)?.version ??
    props.installations
      .flatMap(item => (item.status === 'ready' ? (item.members ?? []) : []))
      .find(member => member.name === base)?.version ??
    props.environments.map(item => item.document.packages[base]).find(range => range && !range.startsWith('file:')) ??
    '*'
  document.value!.id = 'test-120-' + crypto.randomUUID().slice(0, 8)
  document.value!.name = '120 资质测试环境'
  const { rules, include } = validateEnvironmentRuleDeclaration(testEnvironmentRules)
  document.value!.rules = { ...rules, include }
  packageRows.value = [{ name: base, version }]
}
function putPackage(pkg: { name: string; version: string }) {
  const existing = packageRows.value.find(row => row.name === pkg.name)
  if (existing) existing.version = pkg.version
  else packageRows.value.push({ name: pkg.name, version: pkg.version })
  if (document.value) document.value.sources = document.value.sources.filter(name => name !== pkg.name)
}
watch(
  () => props.pendingPackage,
  async pkg => {
    if (!pkg) return
    const target = props.environments.find(item => item.document.id === props.packageEnvironmentId)
    if (target && document.value?.id !== target.document.id) {
      if (!(await edit(target))) return
    } else if (!editing.value && !(await edit(target ?? selectedEnvironment.value))) return
    // Same-environment additions merge into the existing draft.
    putPackage(pkg)
    emit('packageAccepted')
  },
  { immediate: true },
)
function save() {
  if (!document.value || props.busy || !props.canEdit || !props.canPrepare) return
  if (!skillSlotsSchema.optional().safeParse(document.value.rules.mechanics?.skillSlots).success) {
    activeTab.value = 'battle'
    return
  }
  validatePackages.value = true
  const rows = packageRows.value.map(row => ({ name: row.name.trim(), version: row.version.trim() }))
  for (const [index] of rows.entries()) {
    for (const field of ['name', 'version'] as const) {
      if (packageIssue(index, field)) {
        void focusPackage(index, field)
        return
      }
    }
  }
  emit(
    'save',
    {
      ...clone(document.value),
      packages: Object.fromEntries(rows.map(row => [row.name, row.version])),
    },
    revision.value,
    ...(revision.value === null && editingFromId.value && rows.some(row => row.version.startsWith('file:candidates/'))
      ? ([editingFromId.value] as const)
      : []),
  )
}
</script>

<template>
  <section class="environment-workspace" aria-label="环境工作区">
    <header class="section-heading">
      <h2>{{ heading ?? '环境' }}</h2>
      <div class="actions">
        <slot name="toolbar" />
        <ElButton :disabled="!canEdit || busy" native-type="button" @click="createTestEnvironment"
          >从 120 资质测试方案新建</ElButton
        >
        <ElButton
          :disabled="!canEdit || busy"
          :title="!canEdit ? '没有编辑此工作区的权限' : undefined"
          @click="edit()"
          native-type="button"
        >
          新建环境
        </ElButton>
      </div>
    </header>
    <p v-if="!canEdit" class="hint">无编辑权限。</p>
    <div class="workspace-columns">
      <nav class="environment-list" aria-label="选择环境">
        <ElButton
          v-for="environment in environments"
          :key="environment.document.id"
          :disabled="busy"
          :aria-current="selectedEnvironment?.document.id === environment.document.id ? 'true' : undefined"
          @click="selectEnvironment(environment)"
          native-type="button"
        >
          <strong>{{ environment.document.name }}</strong>
          <small v-if="environment.document.id === currentEnvironmentId">本地使用中</small>
          <small
            >{{
              Object.keys(environment.document.packages).length + environment.document.sources.length
            }}
            个直接添加的包</small
          >
        </ElButton>
      </nav>
      <div class="environment-detail">
        <template v-if="selectedEnvironment && !editing">
          <header class="section-heading">
            <h3>{{ selectedEnvironment.document.name }}</h3>
            <div class="actions">
              <ElButton :disabled="!canEdit || busy" @click="edit(selectedEnvironment)" native-type="button"
                >编辑</ElButton
              >
              <ElButton :disabled="!canEdit || busy" @click="duplicate(selectedEnvironment)" native-type="button"
                >复制环境</ElButton
              >
              <ElButton
                v-if="canDelete && !selectedEnvironment.builtin"
                :disabled="busy || selectedEnvironment.document.id === currentEnvironmentId"
                :title="selectedEnvironment.document.id === currentEnvironmentId ? '请先切换本地使用的环境' : undefined"
                @click="deletingDraft = selectedEnvironment.document.id"
                native-type="button"
              >
                删除环境
              </ElButton>
            </div>
          </header>
          <div
            v-if="!selectedEnvironment.builtin && deletingDraft === selectedEnvironment.document.id"
            role="group"
            aria-label="删除环境确认"
          >
            <p>删除后将移除此环境及其安装文件。</p>
            <ElButton :disabled="busy" @click="deleteDraft(selectedEnvironment)" native-type="button"
              >确认删除环境</ElButton
            >
            <ElButton @click="deletingDraft = ''" native-type="button">取消</ElButton>
          </div>
          <section class="members">
            <template
              v-if="latestVersion?.status !== 'ready' || latestVersion.draftRevision !== selectedEnvironment.revision"
            >
              <h4>依赖</h4>
              <ul class="package-list">
                <li v-for="(range, name) in selectedEnvironment.document.packages" :key="name">
                  <strong>{{ name }}</strong>
                  <span>{{ range }}</span>
                </li>
                <li v-for="name in selectedEnvironment.document.sources" :key="name">{{ name }} · 已登记来源</li>
              </ul>
            </template>
            <template v-if="latestVersion?.status === 'ready' && latestVersion.members">
              <h4>环境内的内容包</h4>
              <p v-if="latestVersion.draftRevision !== selectedEnvironment.revision" class="hint">
                依赖已更改，请重新准备。
              </p>
              <article v-for="member in latestVersion.members" :key="member.name" class="member">
                <strong>{{ member.name }}</strong>
                <span>{{ member.version }} · {{ member.direct ? '直接添加' : '自动依赖' }}</span>
                <small v-if="member.requiredBy.length">被依赖：{{ member.requiredBy.join('、') }}</small>
                <small v-if="member.dependencies.length">需要：{{ member.dependencies.join('、') }}</small>
                <small v-if="selectedEnvironment.requiredPackages?.includes(member.name)">默认环境必需</small>
                <ElButton
                  v-else
                  :disabled="busy || !canEdit || !canPrepare"
                  @click="removingPackage = member.name"
                  native-type="button"
                  >移出环境</ElButton
                >
                <slot
                  v-if="member.archiveIntegrity"
                  name="member-actions"
                  :environment="selectedEnvironment"
                  :package-name="member.name"
                  :integrity="member.archiveIntegrity"
                />
                <div v-if="removingPackage === member.name" role="group" aria-label="移出环境确认">
                  <p>
                    {{ member.requiredBy.length ? '其他内容包依赖它，可一并移出环境。' : '' }}
                  </p>
                  <ElButton
                    :disabled="busy || !canEdit || !canPrepare"
                    @click="removePackage(member.name)"
                    native-type="button"
                    >确认移出环境</ElButton
                  >
                  <ElButton
                    v-if="member.requiredBy.length"
                    :disabled="busy || !canEdit || !canPrepare"
                    @click="removePackage(member.name, true)"
                    native-type="button"
                  >
                    连同依赖它的包一起移出环境
                  </ElButton>
                  <ElButton @click="removingPackage = ''" native-type="button">取消</ElButton>
                </div>
              </article>
            </template>
          </section>
        </template>
        <ElForm
          v-if="editing && document"
          class="environment-editor"
          aria-label="编辑环境"
          :disabled="busy || !canEdit"
          :key="editorSession"
          @submit.prevent="save"
          label-position="top"
        >
          <h3>{{ revision === null ? '新建环境' : '编辑环境' }}</h3>
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
          <ElAlert
            v-if="ruleIssue"
            class="rule-preview-issue"
            type="warning"
            :title="ruleIssue"
            show-icon
            :closable="false"
          />
          <ElTabs v-model="activeTab" class="editor-tabs">
            <ElTabPane name="packages" label="内容包依赖">
              <ElFormItem v-if="availablePackages?.length" label="从已安装的包添加">
                <ElSelect
                  :model-value="''"
                  filterable
                  aria-label="选择已有包版本"
                  placeholder="搜索包名或版本"
                  @change="
                    id => {
                      const pkg = availablePackages?.find(item => item.id === id)
                      if (pkg) putPackage(pkg)
                    }
                  "
                >
                  <ElOption
                    v-for="pkg in availablePackages"
                    :key="pkg.id"
                    :value="pkg.id"
                    :disabled="packageRows.some(row => row.name === pkg.name && row.version === pkg.version)"
                    :label="`${pkg.name} ${pkg.version}`"
                  />
                </ElSelect>
              </ElFormItem>
              <slot name="package-source" />
              <div ref="packageList" class="package-fields">
                <div v-for="(row, index) in packageRows" :key="index" class="package-row">
                  <ElFormItem label="包名" class="name-field" :error="packageIssue(index, 'name')">
                    <EnvironmentReferenceInput
                      :options="packageOptions"
                      v-model="row.name"
                      :readonly="!!revision && selectedEnvironment?.requiredPackages?.includes(row.name)"
                      placeholder="@author/package"
                      aria-required="true"
                    />
                  </ElFormItem>
                  <ElFormItem label="版本范围" class="version-field" :error="packageIssue(index, 'version')">
                    <ElInput
                      v-model="row.version"
                      aria-label="版本范围"
                      placeholder="^1.0.0 或 >=1.5 <2"
                      aria-required="true"
                    >
                    </ElInput>
                  </ElFormItem>
                  <ElButton
                    v-if="!revision || !selectedEnvironment?.requiredPackages?.includes(row.name)"
                    @click="packageRows.splice(index, 1)"
                    native-type="button"
                  >
                    移出环境
                  </ElButton>
                </div>
              </div>
              <ElButton @click="addPackageRow" native-type="button">添加内容包</ElButton>
              <ElFormItem label="已登记来源">
                <EnvironmentIdList v-model="document.sources" placeholder="输入来源包名" />
              </ElFormItem>
            </ElTabPane>
            <ElTabPane lazy name="mechanics" label="基础规则">
              <ElFormItem label="引用规则集">
                <ElSelect
                  v-if="ruleSets.length"
                  placeholder="选择或输入规则集 ID"
                  multiple
                  filterable
                  allow-create
                  default-first-option
                  :model-value="document.rules.include ?? []"
                  @update:model-value="setRuleSets"
                >
                  <ElOption
                    v-for="entry in ruleSets"
                    :key="entry.id"
                    :value="entry.id"
                    :label="environmentName('ruleSets', entry.id, entry.name)"
                  />
                </ElSelect>
                <EnvironmentIdList
                  v-else
                  :model-value="document.rules.include"
                  placeholder="输入规则集 ID"
                  @update:model-value="setRuleSets"
                />
              </ElFormItem>
              <div class="field-row mechanic-values">
                <ElFormItem label="单项资质上限">
                  <ElInputNumber
                    :min="0"
                    :max="120"
                    :precision="0"
                    controls-position="right"
                    :model-value="
                      document.rules.mechanics?.individualValues?.max ?? effectiveMechanics?.individualValues.max
                    "
                    @update:model-value="
                      value =>
                        value == null
                          ? inheritMechanic('individualValues')
                          : setMechanics({ individualValues: { max: value } })
                    "
                  />
                  <ElButton
                    link
                    type="primary"
                    v-if="document.rules.mechanics?.individualValues"
                    @click="inheritMechanic('individualValues')"
                    >恢复继承</ElButton
                  >
                </ElFormItem>
                <ElFormItem label="新精灵初始个体值">
                  <ElInputNumber
                    :min="0"
                    :max="120"
                    :precision="0"
                    controls-position="right"
                    :model-value="
                      document.rules.mechanics?.individualValueDefault ??
                      previewComposition?.value?.rules.mechanics?.individualValueDefault
                    "
                    :placeholder="effectiveMechanics && String(effectiveMechanics.individualValues.defaultValue)"
                    @update:model-value="
                      value =>
                        value == null
                          ? inheritMechanic('individualValueDefault')
                          : setMechanics({ individualValueDefault: value })
                    "
                  />
                  <ElButton
                    link
                    type="primary"
                    v-if="document.rules.mechanics?.individualValueDefault !== undefined"
                    @click="inheritMechanic('individualValueDefault')"
                    >恢复继承</ElButton
                  >
                </ElFormItem>
              </div>
              <div class="field-row">
                <ElFormItem label="队伍最少数量">
                  <ElInputNumber
                    :min="1"
                    :max="6"
                    :precision="0"
                    controls-position="right"
                    :placeholder="effectiveTeam && String(effectiveTeam.minSize)"
                    :model-value="document.rules.team?.minSize"
                    @update:model-value="setTeamSize('minSize', $event)"
                  />
                </ElFormItem>
                <ElFormItem label="队伍最多数量">
                  <ElInputNumber
                    :min="1"
                    :max="6"
                    :precision="0"
                    controls-position="right"
                    :placeholder="effectiveTeam && String(effectiveTeam.maxSize)"
                    :model-value="document.rules.team?.maxSize"
                    @update:model-value="setTeamSize('maxSize', $event)"
                  />
                </ElFormItem>
              </div>
              <div class="field-row boolean-fields">
                <EnvironmentBooleanField
                  label="击破奖励换宠"
                  :model-value="document.rules.mechanics?.allowFaintSwitch"
                  :inherited="inheritedMechanics?.allowFaintSwitch"
                  @update:model-value="
                    value =>
                      value === undefined
                        ? inheritMechanic('allowFaintSwitch')
                        : setMechanics({ allowFaintSwitch: value })
                  "
                />
                <EnvironmentBooleanField
                  label="队伍内精灵不重复"
                  :model-value="document.rules.team?.uniqueSpecies"
                  :inherited="inheritedTeam?.uniqueSpecies"
                  @update:model-value="setUniqueSpecies"
                />
              </div>
              <ElCard shadow="never" v-if="previewComposition?.value?.fields.length">
                <template #header><h4>规则预览</h4></template>
                <ElScrollbar max-height="18rem">
                  <dl v-for="field in previewComposition.value.fields" :key="JSON.stringify(field.path)">
                    <dt>{{ field.path.join(' / ') }} · {{ JSON.stringify(field.value) }}</dt>
                    <dd>
                      {{
                        field.sources
                          .map(
                            id =>
                              (id === '$environment' ? '环境声明' : id) +
                              (field.effectiveSources.includes(id) ? '' : '（已覆盖）'),
                          )
                          .join('、')
                      }}
                    </dd>
                  </dl>
                </ElScrollbar></ElCard
              >
            </ElTabPane>
            <ElTabPane lazy name="limits" label="内容限制">
              <div class="editor-sections">
                <EnvironmentContentLimits
                  v-model="document.rules"
                  :options="referenceOptions"
                  :resolved="resolvedRules"
                />
                <EnvironmentConstraintFields
                  v-model="document.rules"
                  :options="referenceOptions"
                  :inherited="inheritance?.value?.declarations.constraints"
                  :effective="resolvedRules?.constraints"
                  :collections="previewComposition?.value?.declarations.collections"
                />
              </div>
            </ElTabPane>
            <ElTabPane lazy name="battle" label="对战机制">
              <div class="editor-sections">
                <EnvironmentLearningFields
                  :options="referenceOptions"
                  v-model="document.rules"
                  :resolved="resolvedRules"
                  :inherited-enhancement="inheritedMechanics?.enhancement"
                />
                <EnvironmentSkillParameterFields
                  :skill-options="referenceOptions.skills"
                  :has-includes="!!document.rules.include?.length"
                  v-model="document.rules"
                  :catalog="previewCatalog?.skillParameters"
                  :resolved="resolvedRules"
                  :applied-known="
                    !!matchingInstallation?.ruleComposition ||
                    (!!matchingInstallation && !matchingInstallation.document.rules.include?.length)
                  "
                  :applied-policy="
                    matchingInstallation?.ruleComposition?.rules.skillParameters ??
                    (!matchingInstallation?.document.rules.include?.length
                      ? matchingInstallation?.document.rules.skillParameters
                      : undefined)
                  "
                />
                <EnvironmentMatchupFields
                  v-model="document.rules"
                  :resolved="resolvedRules"
                  :catalog="previewCatalog?.elementCatalog"
                />
              </div>
            </ElTabPane>
          </ElTabs>
          <div class="actions editor-actions">
            <ElButton class="primary" :disabled="busy || !canEdit || !canPrepare" native-type="submit" type="primary"
              >保存并应用</ElButton
            >
            <ElButton @click="closeEditor" native-type="button">关闭编辑</ElButton>
          </div>
        </ElForm>
        <section v-if="!editing && latestVersion?.status === 'ready'" class="actions">
          <EnvironmentExportButton
            v-if="canExport && previewExport"
            :key="
              JSON.stringify([latestVersion.installationId, latestVersion.draftRevision, latestVersion.contentRevision])
            "
            :version="latestVersion"
            :preview="previewExport"
            :busy="busy"
            @export="(version, selection) => emit('export', version, selection)"
          />
          <ElButton :disabled="busy" @click="emit('references', latestVersion)">查看引用</ElButton>
          <ElButton
            v-if="showUseActions !== false"
            :disabled="busy || !canUse || latestVersion.environmentId === currentEnvironmentId"
            @click="emit('use', latestVersion)"
            >{{ latestVersion.environmentId === currentEnvironmentId ? '本地使用中' : useLabel }}</ElButton
          >
          <ElButton
            v-if="showUseActions !== false && showPeerUse"
            :disabled="busy || !canUse"
            @click="emit('use', latestVersion, 'peer')"
            >P2P 使用</ElButton
          >
        </section>
        <slot v-if="selectedEnvironment && !editing" name="detail" :environment="selectedEnvironment" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.material-picker {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.editor-sections {
  display: grid;
  gap: 14px;
  min-width: 0;
}
.environment-editor :deep(.el-card) {
  min-width: 0;
  --el-card-padding: 14px;
}
.environment-editor :deep(.el-card__header h4) {
  margin: 0;
  font-size: 1rem;
}
.environment-editor :deep(.el-input-tag) {
  width: 100%;
}
.editor-actions {
  justify-content: flex-end;
  border-top: 1px solid var(--el-border-color-light);
  margin-top: 16px;
  padding-top: 12px;
}
.package-fields {
  display: grid;
  gap: 8px;
}
.environment-editor .boolean-fields > .el-form-item {
  flex-basis: 14rem;
}
.package-row > button {
  margin-top: 30px;
}
.package-fields + button {
  margin: 4px 0 16px;
}
.mechanic-values :deep(.el-form-item__content) {
  gap: 8px;
}
.environment-editor :deep(.el-input-number) {
  max-width: 100%;
}
.environment-workspace {
  display: flex;
  flex-direction: column;
}
.workspace-columns {
  display: grid;
  grid-template-columns: minmax(170px, 220px) minmax(0, 1fr);
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
  padding: 0 20px 12px;
  min-width: 0;
}
.environment-detail .section-heading {
  flex-wrap: wrap;
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
  .editor-tabs :deep(.el-tabs__item) {
    padding-inline: 6px;
    font-size: 13px;
  }
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
  flex-wrap: wrap;
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
.environment-editor .package-row,
.environment-editor .field-row {
  align-items: flex-start;
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
</style>
