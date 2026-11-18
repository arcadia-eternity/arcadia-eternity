<script setup lang="ts">
import { defaultEditorSkillSlots, skillSlotsSchema } from '@arcadia-eternity/const'
import { computed, ref, watch } from 'vue'
import type { EnvironmentRules } from '@arcadia-eternity/protocol'
const rules = defineModel<EnvironmentRules>({ required: true })
type Inheritance = NonNullable<NonNullable<EnvironmentRules['mechanics']>['inheritance']>
type Target = Inheritance['eligible']
const props = defineProps<{ resolved?: EnvironmentRules }>()
const mechanics = computed(() => ({ ...props.resolved?.mechanics, ...rules.value.mechanics }))
const inherited = computed(() => mechanics.value.inheritance)
const slots = ref({ normalMax: 4, climaxMax: 1, climaxMin: 0 })
const slotError = ref('')
watch(
  () => mechanics.value.skillSlots,
  value => {
    slots.value = { ...(value ?? defaultEditorSkillSlots), climaxMin: value?.climaxMin ?? 0 }
    slotError.value = ''
  },
  { immediate: true },
)
function saveSlots() {
  const parsed = skillSlotsSchema.safeParse(slots.value)
  if (!parsed.success) {
    slotError.value = '普通与必杀槽合计最多五个，必选数量须在必杀槽数以内'
    return
  }
  rules.value = { ...rules.value, schemaVersion: 2, mechanics: { ...rules.value.mechanics, skillSlots: parsed.data } }
  slotError.value = ''
}
function restore(key: 'inheritance' | 'secondGenerationNatures' | 'enhancement' | 'skillSlots') {
  const next = { ...rules.value, mechanics: { ...rules.value.mechanics } }
  delete next.mechanics[key]
  rules.value = next
}
const mode = (eligible?: Target) => (Array.isArray(eligible) ? 'list' : (eligible ?? 'off'))
const list = (value: string) => [...new Set(value.split(/[\s,，]+/u).filter(Boolean))]
function updateInheritance(next: Inheritance) {
  rules.value = { ...rules.value, schemaVersion: 2, mechanics: { ...rules.value.mechanics, inheritance: next } }
}
function setTarget(target: string) {
  updateInheritance({ ...inherited.value, eligible: target === 'list' ? [] : (target as 'species' | 'all' | 'off') })
}
function setNatureTarget(eligible: Target) {
  rules.value = {
    ...rules.value,
    schemaVersion: 2,
    mechanics: { ...rules.value.mechanics, secondGenerationNatures: eligible },
  }
}
function setPool(value: string) {
  const current = inherited.value ?? { eligible: 'species' }
  if (!value) updateInheritance({ eligible: current.eligible })
  else
    updateInheritance({
      ...current,
      pool: { mode: value as 'fallback' | 'append' | 'replace', skills: current.pool?.skills ?? [] },
    })
}
type Enhancement = NonNullable<NonNullable<EnvironmentRules['mechanics']>['enhancement']>
function setEnhancement(change: Partial<Enhancement>) {
  const next = { mode: 'forbidden' as const, ...mechanics.value.enhancement, ...change }
  rules.value = { ...rules.value, schemaVersion: 2, mechanics: { ...rules.value.mechanics, enhancement: next } }
}
function setEnhancementList(field: 'species' | 'stages', value: string) {
  const values = list(value)
  const next = { ...mechanics.value.enhancement, mode: mechanics.value.enhancement?.mode ?? 'forbidden' } as Enhancement
  if (values.length) next[field] = values
  else delete next[field]
  rules.value = { ...rules.value, schemaVersion: 2, mechanics: { ...rules.value.mechanics, enhancement: next } }
}
function addRow() {
  rules.value = {
    ...rules.value,
    schemaVersion: 2,
    learnsetAdjustments: [
      ...(rules.value.learnsetAdjustments ?? []),
      { species: '', source: 'normal', skill: '', action: 'add' },
    ],
  }
}
function removeRow(index: number) {
  const next = { ...rules.value }
  const rows = next.learnsetAdjustments?.filter((_, i) => i !== index)
  if (rows?.length) next.learnsetAdjustments = rows
  else delete next.learnsetAdjustments
  rules.value = next
}
</script>

<template>
  <fieldset>
    <legend>遗传与配招</legend>
    <details>
      <summary>技能槽位</summary>
      <label>普通槽上限 <input v-model.number="slots.normalMax" type="number" min="0" max="5" /></label>
      <label>必杀槽上限 <input v-model.number="slots.climaxMax" type="number" min="0" max="5" /></label>
      <label>必杀至少装备 <input v-model.number="slots.climaxMin" type="number" min="0" max="5" /></label>
      <button type="button" @click="saveSlots">应用槽位设置</button>
      <button v-if="rules.mechanics?.skillSlots" type="button" @click="restore('skillSlots')">恢复继承槽位</button>
      <p v-if="slotError" role="alert">{{ slotError }}</p>
    </details>
    <label
      >二代性格资格
      <select
        :value="mode(mechanics.secondGenerationNatures)"
        @change="
          setNatureTarget(
            ($event.target as HTMLSelectElement).value === 'list'
              ? []
              : (($event.target as HTMLSelectElement).value as 'species' | 'all' | 'off'),
          )
        "
      >
        <option value="off">关闭</option>
        <option value="species">按物种</option>
        <option value="all">全部物种</option>
        <option value="list">指定物种</option>
      </select>
    </label>
    <label v-if="Array.isArray(mechanics.secondGenerationNatures)"
      >二代性格物种 ID
      <input
        :value="mechanics.secondGenerationNatures.join('，')"
        @change="setNatureTarget(list(($event.target as HTMLInputElement).value))"
      />
    </label>
    <label
      >遗传资格
      <select :value="mode(inherited?.eligible)" @change="setTarget(($event.target as HTMLSelectElement).value)">
        <option value="off">关闭</option>
        <option value="species">按物种</option>
        <option value="all">全部物种</option>
        <option value="list">指定物种</option>
      </select>
    </label>
    <label v-if="Array.isArray(inherited?.eligible)"
      >物种 ID
      <input
        :value="inherited.eligible.join('，')"
        @change="updateInheritance({ ...inherited!, eligible: list(($event.target as HTMLInputElement).value) })"
      />
    </label>
    <template v-if="inherited && inherited.eligible !== 'off'">
      <label
        >遗传池
        <select :value="inherited.pool?.mode ?? ''" @change="setPool(($event.target as HTMLSelectElement).value)">
          <option value="">沿用物种池</option>
          <option value="fallback">为空时使用公共池</option>
          <option value="append">追加公共池</option>
          <option value="replace">统一使用公共池</option>
        </select>
      </label>
      <label v-if="inherited.pool"
        >公共池技能 ID
        <input
          :value="inherited.pool.skills.join('，')"
          @change="
            updateInheritance({
              ...inherited,
              pool: { ...inherited.pool!, skills: list(($event.target as HTMLInputElement).value) },
            })
          "
        />
      </label>
    </template>
    <div v-for="(row, i) in rules.learnsetAdjustments" :key="i" class="field-row">
      <label>物种 ID <input v-model.trim="row.species" /></label>
      <label
        >来源
        <select v-model="row.source" @change="delete row.level">
          <option value="normal">普通</option>
          <option value="inherited">遗传</option>
        </select></label
      >
      <label
        >操作
        <select v-model="row.action" @change="delete row.level">
          <option value="add">增加</option>
          <option value="remove">移除</option>
        </select></label
      >
      <label>技能 ID <input v-model.trim="row.skill" /></label>
      <label v-if="row.source === 'normal' && row.action === 'add'"
        >学习等级
        <input
          type="number"
          min="1"
          max="100"
          :value="row.level ?? 1"
          @change="row.level = Number(($event.target as HTMLInputElement).value)"
        />
      </label>
      <button type="button" @click="removeRow(i)">删除调整</button>
    </div>
    <button
      v-if="rules.mechanics?.secondGenerationNatures !== undefined"
      type="button"
      @click="restore('secondGenerationNatures')"
    >
      恢复继承性格资格
    </button>
    <button v-if="rules.mechanics?.inheritance" type="button" @click="restore('inheritance')">恢复继承遗传规则</button>
    <button type="button" @click="addRow">添加物种技能调整</button>
  </fieldset>
  <fieldset>
    <legend>神魔化</legend>
    <button v-if="rules.mechanics?.enhancement" type="button" @click="restore('enhancement')">
      恢复继承神魔化规则
    </button>
    <select
      aria-label="神魔化规则"
      :value="mechanics.enhancement?.mode ?? 'forbidden'"
      @change="setEnhancement({ mode: ($event.target as HTMLSelectElement).value as Enhancement['mode'] })"
    >
      <option value="forbidden">禁止携带</option>
      <option value="suppressed">可携带，本局不生效</option>
      <option value="active">启用阶段加成</option>
    </select>
    <template v-if="mechanics.enhancement && mechanics.enhancement.mode !== 'forbidden'">
      <label
        >允许阶段 ID（留空为全部）<input
          :value="mechanics.enhancement.stages?.join('，')"
          @change="setEnhancementList('stages', ($event.target as HTMLInputElement).value)"
      /></label>
      <label
        >适用物种 ID（留空为全部）<input
          :value="mechanics.enhancement.species?.join('，')"
          @change="setEnhancementList('species', ($event.target as HTMLInputElement).value)"
      /></label>
    </template>
  </fieldset>
</template>
