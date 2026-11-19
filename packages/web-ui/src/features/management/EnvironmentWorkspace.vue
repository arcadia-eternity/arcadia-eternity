<script setup lang="ts">
import { environmentName } from '@/i18n/environment'
import './managementStyles'
import testEnvironmentRules from '@arcadia-eternity/data-pack-base/environment/test-120-rules.json'
import {
  prepareEnvironmentRules,
  validateEnvironmentRuleDeclaration,
} from '@arcadia-eternity/content-sdk/environment-rules'
import EnvironmentConstraintFields from './EnvironmentConstraintFields.vue'
import EnvironmentSkillParameterFields from './EnvironmentSkillParameterFields.vue'
import EnvironmentMatchupFields from './EnvironmentMatchupFields.vue'
import EnvironmentLearningFields from './EnvironmentLearningFields.vue'
import { registerEnvironmentDraft, discardEnvironmentChanges } from '@/features/content/unsavedEnvironment'
import { ElButton, ElForm, ElFormItem, ElInput, ElCheckbox, ElSelect, ElOption } from 'element-plus'
import { computed, ref, watch } from 'vue'
import type { ManagedEnvironment, ManagedEnvironmentDocument, ManagedEnvironmentInstallation } from '@/types/management'

const props = withDefaults(
  defineProps<{
    availablePackages?: { id: string; name: string; version: string }[]
    packageEnvironmentId?: string
    pendingPackage?: { id: string; name: string; version: string }
    heading?: string
    environments: ManagedEnvironment[]
    installations: ManagedEnvironmentInstallation[]
    canEdit: boolean
    canPrepare: boolean
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
  save: [document: ManagedEnvironmentDocument, expectedRevision: string | null]
  use: [version: ManagedEnvironmentInstallation, executionPolicy?: 'server' | 'peer']
  export: [version: ManagedEnvironmentInstallation]
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
const sourceText = ref('')
const originalDraft = ref('')
const draftValue = () =>
  JSON.stringify({ document: document.value, packages: packageRows.value, sources: sourceText.value })
const dirty = computed(() => editing.value && draftValue() !== originalDraft.value)
registerEnvironmentDraft(() => dirty.value)
async function closeEditor() {
  if (!dirty.value || (await discardEnvironmentChanges())) editing.value = false
}
const validation = ref('')
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
const parameterPreviewVersion = computed(() => {
  const version = latestVersion.value
  if (version?.status === 'ready' && version.environmentId === document.value?.id && revision.value) return version
  return undefined
})
const previewComposition = computed(() => {
  const installed = parameterPreviewVersion.value
  if (!document.value || !installed?.ruleComposition) return undefined
  const packages = Object.fromEntries(packageRows.value.map(row => [row.name, row.version]))
  const samePackages =
    packageRows.value.length === Object.keys(installed.document.packages).length &&
    Object.entries(installed.document.packages).every(([name, version]) => packages[name] === version)
  const sources = sourceText.value
    .split(/\r?\n/)
    .map(id => id.trim())
    .filter(Boolean)
    .sort()
  if (!samePackages || JSON.stringify(sources) !== JSON.stringify([...installed.document.sources].sort()))
    return undefined
  try {
    return {
      value: prepareEnvironmentRules(
        JSON.parse(JSON.stringify(document.value.rules)),
        JSON.parse(JSON.stringify(installed.ruleComposition.ruleSets)),
      ),
    }
  } catch (error) {
    return { issue: error instanceof Error ? error.message : String(error) }
  }
})
const inheritedConstraints = computed(() => {
  if (
    !previewComposition.value ||
    !parameterPreviewVersion.value?.ruleComposition ||
    !document.value?.rules.include?.length
  )
    return []
  try {
    return (
      prepareEnvironmentRules(
        { schemaVersion: 2, include: [...document.value.rules.include] },
        JSON.parse(JSON.stringify(parameterPreviewVersion.value.ruleComposition.ruleSets)),
      ).rules.constraints ?? []
    )
  } catch {
    return []
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
const contentKinds = ['species', 'skills', 'marks'] as const
const contentLabels = { species: '精灵', skills: '技能', marks: '印记' }
function setRuleList(side: 'allow' | 'deny', kind: (typeof contentKinds)[number], value?: string) {
  if (!document.value) return
  const values = [
    ...new Set(
      (value ?? '')
        .split(/[\n,，]/)
        .map(item => item.trim())
        .filter(Boolean),
    ),
  ]
  const current: Partial<Record<(typeof contentKinds)[number], string[]>> = { ...document.value.rules[side] }
  if (value !== undefined && (values.length || document.value.rules.include?.length)) current[kind] = values
  else delete current[kind]
  if (Object.keys(current).length) document.value.rules[side] = current
  else delete document.value.rules[side]
}
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
function setIVLimit(input: string) {
  const max = Number(input)
  if (input.trim() && Number.isInteger(max) && max >= 0 && max <= 120) setMechanics({ individualValues: { max } })
}
function setIVDefault(input: string) {
  const value = Number(input)
  if (input.trim() && Number.isInteger(value) && value >= 0 && value <= 120)
    setMechanics({ individualValueDefault: value })
}
function inheritTeamField(key: 'minSize' | 'maxSize' | 'uniqueSpecies') {
  if (!document.value?.rules.team) return
  delete document.value.rules.team[key]
  if (!Object.keys(document.value.rules.team).length) delete document.value.rules.team
}
function setTeamSize(key: 'minSize' | 'maxSize', value: string) {
  if (!document.value) return
  if (value === '') inheritTeamField(key)
  else document.value.rules.team = { ...document.value.rules.team, [key]: Number(value) }
}
const clone = (value: ManagedEnvironmentDocument): ManagedEnvironmentDocument => JSON.parse(JSON.stringify(value))

async function edit(environment?: ManagedEnvironment) {
  if (dirty.value && !(await discardEnvironmentChanges())) return false
  if (environment) selectedId.value = environment.document.id
  revision.value = environment?.revision ?? null
  document.value = environment
    ? clone(environment.document)
    : { schemaVersion: 2, id: '', name: '', packages: {}, sources: [], rules: { schemaVersion: 1 }, requires: {} }
  packageRows.value = Object.entries(document.value.packages).map(([name, version]) => ({ name, version }))
  sourceText.value = document.value.sources.join('\n')
  validation.value = ''
  originalDraft.value = draftValue()
  editing.value = true
  return true
}
async function createTestEnvironment() {
  if (!(await edit())) return
  const base = '@arcadia-eternity/data-pack-base'
  const version =
    props.availablePackages?.find(pkg => pkg.name === base)?.version ??
    props.environments.find(item => item.document.packages[base])?.document.packages[base] ??
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
  sourceText.value = sourceText.value
    .split(/\r?\n/)
    .filter(name => name.trim() !== pkg.name)
    .join('\n')
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
            <legend>依赖</legend>
            <label v-if="availablePackages?.length"
              >已有材料
              <ElSelect
                :model-value="''"
                aria-label="选择已有包版本"
                placeholder="选择内容包版本"
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
                  :label="`${pkg.name} ${pkg.version}`"
                />
              </ElSelect>
            </label>
            <slot name="package-source" />
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
                移出环境
              </ElButton>
            </div>
            <ElButton @click="packageRows.push({ name: '', version: '' })" native-type="button">添加内容包</ElButton>
          </fieldset>
          <details>
            <summary>已登记来源</summary>
            <ElFormItem label="来源包名（每行一个）">
              <ElInput v-model="sourceText" :rows="3" type="textarea" />
            </ElFormItem>
          </details>
          <fieldset>
            <legend>配置</legend>
            <ElFormItem label="引用规则集">
              <ElSelect
                multiple
                filterable
                allow-create
                default-first-option
                :model-value="document.rules.include ?? []"
                @update:model-value="setRuleSets"
              >
                <ElOption
                  v-for="entry in parameterPreviewVersion?.ruleComposition?.ruleSets ?? []"
                  :key="entry.id"
                  :value="entry.id"
                  :label="environmentName('ruleSets', entry.id, entry.name)"
                />
              </ElSelect>
            </ElFormItem>
            <p v-if="previewComposition?.issue" role="alert">{{ previewComposition.issue }}</p>
            <details v-if="previewComposition?.value?.fields.length">
              <summary>按已准备内容预览规则</summary>
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
            </details>
            <EnvironmentConstraintFields
              v-model="document.rules"
              :inherited="inheritedConstraints"
              :key="document.id"
            />
            <EnvironmentLearningFields v-model="document.rules" :resolved="previewComposition?.value?.rules" />
            <EnvironmentSkillParameterFields
              v-model="document.rules"
              :catalog="parameterPreviewVersion?.skillParameters"
              :preview-policy="previewComposition?.value?.rules.skillParameters"
              :applied-policy="
                parameterPreviewVersion?.ruleComposition?.rules.skillParameters ??
                parameterPreviewVersion?.document.rules.skillParameters
              "
              :key="'skills-' + document.id"
            />
            <EnvironmentMatchupFields
              v-model="document.rules"
              :preview-policy="previewComposition?.value?.rules.matchups"
              :catalog="parameterPreviewVersion?.elementCatalog"
            />
            <ElFormItem label="单项资质上限">
              <ElInput
                type="number"
                min="0"
                max="120"
                :model-value="
                  document.rules.mechanics?.individualValues?.max ??
                  previewComposition?.value?.rules.mechanics?.individualValues?.max ??
                  (document.rules.include?.length ? undefined : 31)
                "
                @change="setIVLimit($event)"
              />
            </ElFormItem>
            <ElButton v-if="document.rules.mechanics?.individualValues" @click="inheritMechanic('individualValues')"
              >恢复继承个体上限</ElButton
            >
            <ElFormItem label="新精灵初始个体值">
              <ElInput
                type="number"
                min="0"
                max="120"
                :model-value="
                  document.rules.mechanics?.individualValueDefault ??
                  previewComposition?.value?.rules.mechanics?.individualValueDefault
                "
                :placeholder="
                  String(
                    Math.min(
                      31,
                      previewComposition?.value?.rules.mechanics?.individualValues?.max ??
                        document.rules.mechanics?.individualValues?.max ??
                        31,
                    ),
                  )
                "
                @change="setIVDefault($event)"
              />
            </ElFormItem>
            <ElButton
              v-if="document.rules.mechanics?.individualValueDefault !== undefined"
              @click="inheritMechanic('individualValueDefault')"
              >恢复继承初始个体值</ElButton
            >
            <ElCheckbox
              :indeterminate="
                !!document.rules.include?.length &&
                !previewComposition?.value &&
                document.rules.mechanics?.allowFaintSwitch === undefined
              "
              :model-value="
                document.rules.mechanics?.allowFaintSwitch ??
                previewComposition?.value?.rules.mechanics?.allowFaintSwitch ??
                true
              "
              @change="setMechanics({ allowFaintSwitch: Boolean($event) })"
              >击破奖励换宠</ElCheckbox
            >
            <ElButton
              v-if="document.rules.mechanics?.allowFaintSwitch !== undefined"
              @click="inheritMechanic('allowFaintSwitch')"
              >恢复继承击破奖励</ElButton
            >
            <div class="field-row">
              <ElFormItem label="队伍最少数量">
                <ElInput
                  type="number"
                  min="1"
                  max="6"
                  :placeholder="String(previewComposition?.value?.rules.team?.minSize ?? 1)"
                  :model-value="document.rules.team?.minSize"
                  @input="setTeamSize('minSize', $event)"
                />
              </ElFormItem>
              <ElFormItem label="队伍最多数量">
                <ElInput
                  type="number"
                  min="1"
                  max="6"
                  :placeholder="String(previewComposition?.value?.rules.team?.maxSize ?? 6)"
                  :model-value="document.rules.team?.maxSize"
                  @input="setTeamSize('maxSize', $event)"
                />
              </ElFormItem>
            </div>
            <ElCheckbox
              :model-value="
                document.rules.team?.uniqueSpecies ?? previewComposition?.value?.rules.team?.uniqueSpecies ?? false
              "
              @change="
                document.rules.team = {
                  ...document.rules.team,
                  uniqueSpecies: Boolean($event),
                }
              "
              >队伍内精灵不重复</ElCheckbox
            >
            <ElButton
              v-if="document.rules.include?.length && document.rules.team?.uniqueSpecies !== undefined"
              @click="inheritTeamField('uniqueSpecies')"
              >恢复继承</ElButton
            >
            <fieldset v-for="side in ['allow', 'deny'] as const" :key="side">
              <legend>{{ side === 'allow' ? '允许内容' : '禁止内容' }}</legend>
              <ElFormItem
                v-for="kind in contentKinds"
                :key="kind"
                :label="String(contentLabels[kind]) + '标识（每行一个）'"
              >
                <ElInput
                  :placeholder="
                    document.rules[side]?.[kind] === undefined
                      ? previewComposition?.value?.rules[side]?.[kind]?.join('\n')
                      : undefined
                  "
                  :model-value="document.rules[side]?.[kind]?.join('\n') ?? ''"
                  :rows="2"
                  @input="setRuleList(side, kind, $event)"
                  type="textarea"
                />
                <ElButton
                  v-if="document.rules.include?.length && document.rules[side]?.[kind] !== undefined"
                  @click="setRuleList(side, kind)"
                  >恢复继承</ElButton
                >
                <ElButton v-else-if="document.rules.include?.length" @click="setRuleList(side, kind, '')">{{
                  side === 'deny' ? '清除禁用' : '全部禁用'
                }}</ElButton>
              </ElFormItem>
            </fieldset>
          </fieldset>
          <div class="actions">
            <ElButton class="primary" :disabled="busy || !canEdit || !canPrepare" native-type="submit" type="primary"
              >保存并应用</ElButton
            >
            <ElButton @click="closeEditor" native-type="button">关闭编辑</ElButton>
          </div>
        </ElForm>
        <section v-if="!editing && latestVersion?.status === 'ready'" class="actions">
          <ElButton v-if="canExport" :disabled="busy" @click="emit('export', latestVersion)">导出环境</ElButton>
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
.environment-editor fieldset {
  padding: 12px;
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
