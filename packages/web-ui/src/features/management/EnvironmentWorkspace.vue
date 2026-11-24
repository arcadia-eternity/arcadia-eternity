<script lang="ts">
export interface EnvironmentNavigation {
  entries: (EnvironmentLocation & { environment: ManagedEnvironment })[]
  selected: string
}
</script>
<script setup lang="ts">
import { customAlphabet } from 'nanoid'
import type {
  EnvironmentExportPreview,
  EnvironmentExportSelection,
} from '@arcadia-eternity/content-sdk/management-workspace'
import { managedLocation, type EnvironmentLocation } from '@/features/content/environmentGroups'
import { Plus } from '@element-plus/icons-vue'
import EnvironmentLayout from '@/features/content/EnvironmentLayout.vue'
import EnvironmentPanel from '@/features/content/EnvironmentPanel.vue'
import EnvironmentDetailHeading from '@/features/content/EnvironmentDetailHeading.vue'
import EnvironmentPackageRow from '@/features/content/EnvironmentPackageRow.vue'
import EnvironmentDirectory from '@/features/content/EnvironmentDirectory.vue'
import EnvironmentExportButton from './EnvironmentExportButton.vue'
import EnvironmentReferenceInput from './EnvironmentReferenceInput.vue'
import EnvironmentBooleanField from './EnvironmentBooleanField.vue'
import EnvironmentIdList from './EnvironmentIdList.vue'
import { resolveDraftContent, rulePreviewIssue, type EditorPackage } from './environmentRuleCatalog'
import { environmentReferences } from './environmentReferences'
import './managementStyles'
import {
  assertRuleContentReferences,
  indexRuleContent,
  prepareEnvironmentRules,
  resolveEnvironmentMechanics,
} from '@arcadia-eternity/content-sdk/environment-rules'
import { resolveEnvironmentTeam, skillSlotsSchema } from '@arcadia-eternity/const'
import EnvironmentContentLimits from './EnvironmentContentLimits.vue'
import EnvironmentConstraintFields from './EnvironmentConstraintFields.vue'
import EnvironmentSkillParameterFields from './EnvironmentSkillParameterFields.vue'
import EnvironmentMatchupFields from './EnvironmentMatchupFields.vue'
import EnvironmentBattleFields from './EnvironmentBattleFields.vue'
import EnvironmentLearningFields from './EnvironmentLearningFields.vue'
import { registerEnvironmentDraft, discardEnvironmentChanges } from '@/features/content/unsavedEnvironment'
import {
  ElAlert,
  ElButton,
  ElCard,
  ElCheckbox,
  ElEmpty,
  ElTag,
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
    allowServerCreation?: boolean
    hideNavigation?: boolean
    navigation?: EnvironmentNavigation
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
  createOnServer: [document: ManagedEnvironmentDocument]
  navigate: [key: string, edit?: boolean]
  packageAccepted: []
  removePackage: [environment: ManagedEnvironment, name: string, cascade: boolean]
  save: [document: ManagedEnvironmentDocument, expectedRevision: string | null, copyFrom?: string]
  use: [version: ManagedEnvironmentInstallation, executionPolicy?: 'server' | 'peer']
  export: [version: ManagedEnvironmentInstallation, selection: EnvironmentExportSelection]
  delete: [version: ManagedEnvironmentInstallation]
  deleteDraft: [environment: ManagedEnvironment]
}>()
const editRequested = defineModel<boolean>('editRequested', { default: false })
const editing = ref(false)
const createOnServer = ref(false)
watch(
  () => props.saveSequence,
  () => {
    if (editing.value && revision.value === null) {
      const created = props.environments.find(item => item.document.id === document.value?.id)
      const entry = entries.value.find(item => item.environment === created)
      if (entry) {
        selectedId.value = entry.key
        emit('navigate', entry.key)
      }
    }
    editing.value = false
  },
)
const revision = ref<string | null>(null)
const document = ref<ManagedEnvironmentDocument>()
const basePackageName = '@arcadia-eternity/data-pack-base'
const packageRows = ref<{ name: string; version: string; required?: boolean }[]>([])
function requiredPackage(name: string) {
  return name === basePackageName || !!selectedEnvironment.value?.requiredPackages?.includes(name)
}
const requiredSources = computed(() => document.value?.sources.filter(requiredPackage) ?? [])
const editableSources = computed({
  get: () => document.value?.sources.filter(name => !requiredPackage(name)) ?? [],
  set: (sources: string[]) => {
    if (document.value) document.value.sources = [...new Set([...requiredSources.value, ...sources])]
  },
})
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
const draftValue = () =>
  JSON.stringify({ document: document.value, packages: packageRows.value, createOnServer: createOnServer.value })
const dirty = computed(() => editing.value && draftValue() !== originalDraft.value)
registerEnvironmentDraft(
  () => dirty.value,
  () => editing.value,
)
async function closeEditor() {
  if (!dirty.value || (await discardEnvironmentChanges())) editing.value = false
}
const selectedId = ref('')
const entries = computed(
  () =>
    props.navigation?.entries ??
    props.environments.map(environment => ({
      ...managedLocation(environment, '', props.heading ?? '', props.installations),
      key: environment.document.id,
      editable: props.canEdit && !environment.builtin,
      current: environment.document.id === props.currentEnvironmentId,
    })),
)
const selectedEntry = computed(
  () =>
    entries.value.find(item => item.key === (props.navigation?.selected ?? selectedId.value)) ??
    (props.navigation?.selected ? undefined : entries.value[0]),
)
const selectedEnvironment = computed(() => selectedEntry.value?.environment)
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
function previewRules(rules: ManagedEnvironmentDocument['rules']) {
  try {
    return { value: prepareEnvironmentRules(rules) }
  } catch (error) {
    return { issue: rulePreviewIssue(error) }
  }
}
const previewComposition = computed(() => document.value && previewRules(document.value.rules))
const effectiveMechanics = computed(
  () => previewComposition.value?.value && resolveEnvironmentMechanics(previewComposition.value.value.rules),
)
const resolvedRules = computed(() => previewComposition.value?.value?.rules)
const effectiveTeam = computed(() => resolvedRules.value && resolveEnvironmentTeam(resolvedRules.value))
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
function resetMechanic(key: 'individualValues' | 'individualValueDefault') {
  if (!document.value?.rules.mechanics) return
  delete document.value.rules.mechanics[key]
  if (!Object.keys(document.value.rules.mechanics).length) delete document.value.rules.mechanics
}
const deletingDraft = ref('')
const removingPackage = ref('')
function removePackage(name: string, cascade = false) {
  if (!selectedEnvironment.value || requiredPackage(name)) return
  removingPackage.value = ''
  emit('removePackage', selectedEnvironment.value, name, cascade)
}
const environmentSuffix = customAlphabet('0123456789abcdef')
async function duplicate(environment: ManagedEnvironment) {
  if (!(await edit(environment, true))) return
  revision.value = null
  document.value!.id = `${environment.document.id.slice(0, 60)}-copy-${environmentSuffix(6)}`
  document.value!.name += ' 副本'
}
function deleteDraft(environment: ManagedEnvironment) {
  if (environment.builtin) return
  deletingDraft.value = ''
  emit('deleteDraft', environment)
}
async function selectEnvironment(key: string, startEdit = false) {
  if (key === selectedEntry.value?.key) return
  if (dirty.value && !(await discardEnvironmentChanges())) return
  deletingDraft.value = ''
  removingPackage.value = ''
  selectedId.value = key
  emit('navigate', key, startEdit)
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
function setMechanics(change: NonNullable<ManagedEnvironmentDocument['rules']['mechanics']>) {
  if (!document.value) return
  document.value.rules = {
    ...document.value.rules,
    schemaVersion: 2,
    mechanics: { ...document.value.rules.mechanics, ...change },
  }
}
function resetTeamField(key: 'minSize' | 'maxSize' | 'uniqueSpecies') {
  if (!document.value?.rules.team) return
  delete document.value.rules.team[key]
  if (!Object.keys(document.value.rules.team).length) delete document.value.rules.team
}
function setUniqueSpecies(value: boolean) {
  if (document.value) document.value.rules.team = { ...document.value.rules.team, uniqueSpecies: value }
}
function setTeamSize(key: 'minSize' | 'maxSize', value: number | null | undefined) {
  if (!document.value) return
  if (value == null) resetTeamField(key)
  else document.value.rules.team = { ...document.value.rules.team, [key]: value }
}
const clone = (value: ManagedEnvironmentDocument): ManagedEnvironmentDocument => JSON.parse(JSON.stringify(value))

async function edit(environment?: ManagedEnvironment, duplicate = false) {
  if (environment?.builtin && !duplicate) return false
  if (dirty.value && !(await discardEnvironmentChanges())) return false
  if (environment) {
    const entry = entries.value.find(item => item.environment === environment)
    if (entry) {
      selectedId.value = entry.key
      emit('navigate', entry.key)
    }
  }
  editingFromId.value = environment?.document.id
  createOnServer.value = false
  revision.value = environment?.revision ?? null
  document.value = environment
    ? clone(environment.document)
    : {
        schemaVersion: 2,
        id: '',
        name: '',
        packages: {},
        sources: [basePackageName],
        rules: { schemaVersion: 2, mechanics: { timer: { enabled: false }, teamSelection: { enabled: false } } },
        requires: {},
      }
  packageRows.value = Object.entries(document.value.packages).map(([name, version]) => ({
    name,
    version,
    required: name === basePackageName || !!environment?.requiredPackages?.includes(name),
  }))
  editorSession.value++
  activeTab.value = 'packages'
  validatePackages.value = false
  originalDraft.value = draftValue()
  editing.value = true
  return true
}
watch(
  [editRequested, selectedEnvironment],
  ([requested, environment]) => {
    if (requested && environment) {
      editRequested.value = false
      if (props.canEdit && !props.busy) void edit(environment)
    }
  },
  { immediate: true },
)
function putPackage(pkg: { name: string; version: string }) {
  const existing = packageRows.value.find(row => row.name === pkg.name)
  if (existing) {
    existing.version = pkg.version
    existing.required = requiredPackage(pkg.name)
  } else packageRows.value.push({ name: pkg.name, version: pkg.version, required: requiredPackage(pkg.name) })
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
  if (!rows.length && !document.value.sources.length) {
    activeTab.value = 'packages'
    return
  }
  const result = {
    ...clone(document.value),
    packages: Object.fromEntries(rows.map(row => [row.name, row.version])),
  }
  if (revision.value === null && createOnServer.value) {
    emit('createOnServer', result)
    return
  }
  emit(
    'save',
    result,
    revision.value,
    ...(revision.value === null && editingFromId.value && rows.some(row => row.version.startsWith('file:candidates/'))
      ? ([editingFromId.value] as const)
      : []),
  )
}
</script>

<template>
  <section class="environment-workspace" aria-label="环境工作区">
    <EnvironmentLayout>
      <template v-if="!hideNavigation" #directory>
        <EnvironmentDirectory
          :entries="entries"
          :selected="selectedEntry?.key"
          :busy="busy"
          @select="selectEnvironment"
        />
      </template>
      <EnvironmentPanel :heading="heading ?? '环境'">
        <template #tools>
          <slot name="toolbar" />
          <ElButton
            type="primary"
            :icon="Plus"
            :disabled="!canEdit || busy"
            :title="!canEdit ? '没有编辑此工作区的权限' : undefined"
            @click="edit()"
            >新建环境</ElButton
          >
        </template>
        <ElAlert v-if="!canEdit" type="info" title="无编辑权限。" :closable="false" show-icon />
        <ElEmpty v-if="!entries.length && !editing" :image-size="64" description="暂无环境" />
        <p v-if="navigation?.selected && !selectedEnvironment && !editing" role="status">此来源的环境已不可用。</p>
        <template v-if="selectedEnvironment && !editing">
          <EnvironmentDetailHeading :name="selectedEnvironment.document.name" :readonly="selectedEnvironment.builtin">
            <template #status>
              <ElTag
                v-if="latestVersion?.status === 'ready' && latestVersion.draftRevision === selectedEnvironment.revision"
                type="success"
                size="small"
                >已就绪</ElTag
              >
              <ElTag v-else type="warning" size="small">待应用</ElTag>
            </template>
            <ElButton
              v-if="!selectedEnvironment.builtin"
              :disabled="!canEdit || busy"
              @click="edit(selectedEnvironment)"
              native-type="button"
              >编辑</ElButton
            >
            <ElButton :disabled="!canEdit || busy" @click="duplicate(selectedEnvironment)" native-type="button"
              >复制环境</ElButton
            >
            <ElButton
              v-if="canDelete && !selectedEnvironment.builtin"
              :disabled="busy || selectedEnvironment.document.id === currentEnvironmentId"
              :title="selectedEnvironment.document.id === currentEnvironmentId ? '请先切换本地使用的环境' : undefined"
              text
              type="danger"
              @click="deletingDraft = selectedEnvironment.document.id"
              native-type="button"
            >
              删除环境
            </ElButton>
          </EnvironmentDetailHeading>
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
              v-if="
                latestVersion?.status !== 'ready' ||
                !latestVersion.members ||
                latestVersion.draftRevision !== selectedEnvironment.revision
              "
            >
              <h4>依赖</h4>
              <EnvironmentPackageRow
                v-for="(range, name) in selectedEnvironment.document.packages"
                :key="name"
                :name="String(name)"
                :version="range"
              />
              <EnvironmentPackageRow v-for="name in selectedEnvironment.document.sources" :key="name" :name="name"
                >按包名查找</EnvironmentPackageRow
              >
              <ElEmpty
                v-if="
                  !Object.keys(selectedEnvironment.document.packages).length &&
                  !selectedEnvironment.document.sources.length
                "
                :image-size="48"
                description="暂无依赖"
              />
            </template>
            <template v-if="latestVersion?.status === 'ready' && latestVersion.members">
              <h4>环境内的内容包</h4>
              <p v-if="latestVersion.draftRevision !== selectedEnvironment.revision" class="hint">
                依赖已更改，请重新准备。
              </p>
              <ElEmpty v-if="!latestVersion.members.length" :image-size="48" description="暂无内容包" />
              <EnvironmentPackageRow
                v-for="member in latestVersion.members"
                :key="member.name"
                :name="member.name"
                :version="member.version"
              >
                <span>{{ member.direct ? '直接添加' : '自动依赖' }}</span>
                <small v-if="member.requiredBy.length">被依赖：{{ member.requiredBy.join('、') }}</small>
                <small v-if="member.dependencies.length">需要：{{ member.dependencies.join('、') }}</small>
                <small v-if="requiredPackage(member.name)">环境必需</small>
                <template #actions>
                  <ElButton
                    v-if="!selectedEnvironment.builtin && !requiredPackage(member.name)"
                    :disabled="busy || !canEdit || !canPrepare"
                    link
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
                  <div
                    v-if="removingPackage === member.name && !requiredPackage(member.name)"
                    role="group"
                    aria-label="移出环境确认"
                  >
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
                </template>
              </EnvironmentPackageRow>
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
          <ElCheckbox
            v-if="
              revision === null &&
              (allowServerCreation || createOnServer) &&
              (!editingFromId || selectedEnvironment?.builtin)
            "
            v-model="createOnServer"
            >保存到本机服务器</ElCheckbox
          >
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
              <ElAlert
                v-if="validatePackages && !packageRows.length && !document.sources.length"
                type="error"
                title="请添加至少一个内容包。"
                show-icon
                :closable="false"
              />
              <slot name="package-source" />
              <div ref="packageList" class="package-fields">
                <div v-for="(row, index) in packageRows" :key="index" class="package-row">
                  <ElFormItem label="包名" class="name-field" :error="packageIssue(index, 'name')">
                    <ElInput v-if="row.required" :model-value="row.name" readonly />
                    <EnvironmentReferenceInput
                      v-else
                      :options="packageOptions"
                      v-model="row.name"
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
                  <ElTag v-if="row.required" type="info">环境必需</ElTag>
                  <ElButton v-else @click="packageRows.splice(index, 1)" native-type="button"> 移出环境 </ElButton>
                </div>
              </div>
              <ElButton @click="addPackageRow" native-type="button">添加内容包</ElButton>
              <ElFormItem label="按包名查找">
                <ElTag v-for="name in requiredSources" :key="name" type="info"
                  ><span>{{ name }}</span> · 环境必需</ElTag
                >
                <EnvironmentIdList v-model="editableSources" placeholder="输入包名" />
              </ElFormItem>
            </ElTabPane>
            <ElTabPane lazy name="mechanics" label="基础规则">
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
                          ? resetMechanic('individualValues')
                          : setMechanics({ individualValues: { max: value } })
                    "
                  />
                  <ElButton
                    link
                    type="primary"
                    v-if="document.rules.mechanics?.individualValues"
                    @click="resetMechanic('individualValues')"
                    >恢复默认</ElButton
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
                          ? resetMechanic('individualValueDefault')
                          : setMechanics({ individualValueDefault: value })
                    "
                  />
                  <ElButton
                    link
                    type="primary"
                    v-if="document.rules.mechanics?.individualValueDefault !== undefined"
                    @click="resetMechanic('individualValueDefault')"
                    >恢复默认</ElButton
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
                  :model-value="document.rules.mechanics?.allowFaintSwitch ?? true"
                  @update:model-value="value => setMechanics({ allowFaintSwitch: value })"
                />
                <EnvironmentBooleanField
                  label="队伍内精灵不重复"
                  :model-value="document.rules.team?.uniqueSpecies ?? false"
                  @update:model-value="setUniqueSpecies"
                />
              </div>
              <ElCard shadow="never" v-if="previewComposition?.value?.fields.length">
                <template #header><h4>规则预览</h4></template>
                <ElScrollbar max-height="18rem">
                  <ul>
                    <li v-for="field in previewComposition.value.fields" :key="JSON.stringify(field.path)">
                      {{ field.path.join(' / ') }} · {{ JSON.stringify(field.value) }}
                    </li>
                  </ul>
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
                <EnvironmentConstraintFields v-model="document.rules" :options="referenceOptions" />
              </div>
            </ElTabPane>
            <ElTabPane lazy name="battle" label="对战机制">
              <div class="editor-sections">
                <EnvironmentBattleFields v-model="document.rules" />
                <EnvironmentLearningFields
                  :options="referenceOptions"
                  v-model="document.rules"
                  :resolved="resolvedRules"
                />
                <EnvironmentSkillParameterFields
                  :skill-options="referenceOptions.skills"
                  v-model="document.rules"
                  :catalog="previewCatalog?.skillParameters"
                  :resolved="resolvedRules"
                  :applied-known="!!matchingInstallation"
                  :applied-policy="matchingInstallation?.document.rules.skillParameters"
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
            <ElButton
              class="primary"
              :loading="busy"
              :disabled="busy || !canEdit || !canPrepare"
              native-type="submit"
              type="primary"
              >保存并应用</ElButton
            >
            <ElButton @click="closeEditor" native-type="button">关闭编辑</ElButton>
          </div>
        </ElForm>
        <section v-if="!editing && latestVersion?.status === 'ready'" class="actions use-actions">
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
          <ElButton
            v-if="showUseActions !== false"
            :type="latestVersion.environmentId === currentEnvironmentId ? undefined : 'primary'"
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
        <div v-if="$slots.settings" class="environment-settings"><slot name="settings" /></div>
      </EnvironmentPanel>
    </EnvironmentLayout>
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
  min-width: 0;
}
.members h4,
.environment-editor h3 {
  margin: 0 0 12px;
  font-weight: 600;
}
.members h4 {
  font-size: 14px;
}
.hint {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.actions,
.field-row,
.package-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  flex-wrap: wrap;
}
.actions :deep(.el-button) {
  margin: 0;
}
.environment-settings {
  margin-top: 16px;
  border-top: 1px solid var(--el-border-color-lighter);
  padding-top: 8px;
}
.use-actions:not(:empty) {
  border-top: 1px solid var(--el-border-color-lighter);
  padding-top: 16px;
}
.field-row > .el-form-item,
.package-row > .el-form-item {
  flex: 1;
  min-width: min(140px, 100%);
}
@media (max-width: 600px) {
  .editor-tabs :deep(.el-tabs__item) {
    padding-inline: 6px;
    font-size: 13px;
  }
}
</style>
