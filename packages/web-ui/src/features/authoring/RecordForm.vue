<script setup lang="ts">
import { computed, ref } from 'vue'
import { Element } from '@arcadia-eternity/const'
import ChoicePicker from './ChoicePicker.vue'
import { fieldLabel, referenceTarget, referenceValue } from './catalog'
import { atField, clone, object, setField, sharedAt } from './fields'
import type { Json } from '@arcadia-eternity/pack-loader/native'
import type { ContentRow, SharedField, SourceRecord } from './types'
const props = defineProps<{
  record: ContentRow
  kind: string
  records: SourceRecord[]
  projectId: string
  assets: string[]
  sharedFields?: SharedField[]
  section?: 'base' | 'references' | 'media' | 'all'
  hideIdentity?: boolean
  labels?: Record<string, string>
}>()
const emit = defineEmits<{
  change: [record: ContentRow]
  external: [line?: number, column?: number]
  navigate: [kind: string, id: string]
  preview: [file: string]
}>()
const visible = (section: string) => !props.section || props.section === 'all' || props.section === section
const locked = (path: string) => sharedAt(props.sharedFields ?? [], path.split('.'))
const get = (path: string) => atField(props.record, path.split('.'))
const text = (path: string) => {
  const value = get(path)
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}
const list = (key: string) => (Array.isArray(props.record[key]) ? (props.record[key] as Json[]) : [])
function change(path: string, value: Json | undefined) {
  if (locked(path)) return
  const record = clone(props.record)
  setField(record, path.split('.'), value)
  emit('change', record)
}
function number(path: string, event: Event) {
  const value = (event.target as HTMLInputElement).value
  if (value !== '' && Number.isFinite(Number(value))) change(path, Number(value))
}
const problem = computed(() => {
  for (const key of ['baseStats', 'config', 'presentation'])
    if (props.record[key] !== undefined && !object(props.record[key])) return `${key} 格式异常，请在外部编辑器修复。`
  for (const key of ['learnable_skills', 'ability', 'emblem', 'behaviors'])
    if (props.record[key] !== undefined && !Array.isArray(props.record[key]))
      return `${key} 格式异常，请在外部编辑器修复。`
  return ''
})
const numeric = computed(() =>
  props.kind === 'species'
    ? {
        'baseStats.hp': '生命',
        'baseStats.atk': '物攻',
        'baseStats.def': '物防',
        'baseStats.spa': '特攻',
        'baseStats.spd': '特防',
        'baseStats.spe': '速度',
      }
    : props.kind === 'skills'
      ? { power: '威力', rage: '怒气消耗', accuracy: '命中率', priority: '优先级' }
      : { 'config.duration': '持续回合（-1 为无限）', 'config.maxStacks': '最多层数' },
)
const picking = ref(false),
  mediaPick = ref(''),
  selectionError = ref(''),
  slot = ref('learnable_skills')
const referenceKind = computed(() =>
  props.kind !== 'species' ? 'behaviors' : slot.value === 'learnable_skills' ? 'skills' : 'marks',
)
const referenceSlot = computed(() => (props.kind === 'species' ? slot.value : 'behaviors'))
function pickReference(key: string) {
  slot.value = key
  picking.value = true
}
const options = computed(() => {
  const known = new Map(
    props.records
      .filter(row => row.kind === referenceKind.value)
      .map(row => [
        row.record.id,
        {
          id: row.record.id,
          label: props.labels?.[`${row.kind}:${row.record.id}`] || String(row.record.name || row.record.id),
          detail: row.record.id,
        },
      ]),
  )
  // Code-defined effects may have no standalone data record. Offer IDs already referenced by this project without executing code.
  if (referenceKind.value === 'behaviors')
    for (const row of props.records) {
      if (!Array.isArray(row.record.behaviors)) continue
      for (const use of row.record.behaviors) {
        const value = object(use) ? use.definitionId : undefined
        if (!object(value) || !object(value.$ref)) continue
        const ref = referenceTarget(value, 'behaviors', props.projectId)
        if (ref && ref.kind === 'behaviors' && !known.has(ref.id))
          known.set(ref.id, { id: ref.id, label: ref.id, detail: '项目已有引用 · 实现在外部代码中维护' })
      }
    }
  return [...known.values()].map(option => ({
    ...option,
    disabled: list(referenceSlot.value).some(entry => {
      const ref = referenceTarget(referenceValue(entry, referenceSlot.value), referenceKind.value, props.projectId)
      return ref?.id === option.id && ref.kind === referenceKind.value
    }),
  }))
})
function target(value: Json | undefined, key: string) {
  return referenceTarget(
    value,
    key === 'learnable_skills' ? 'skills' : key === 'behaviors' ? 'behaviors' : 'marks',
    props.projectId,
  )
}
function referenceLabel(value: Json | undefined, key: string): string {
  const ref = target(value, key)
  if (ref) return props.labels?.[`${ref.kind}:${ref.id}`] || ref.id
  if (object(value) && object(value.$ref)) return `${value.$ref.projectId}:${value.$ref.id}`
  return '外部或未识别引用（保留原数据）'
}
function openReference(value: Json | undefined, key: string) {
  const ref = target(value, key)
  if (ref) emit('navigate', ref.kind, ref.id)
}
function addReference(id: string) {
  if (!options.value.some(option => option.id === id && !option.disabled)) return
  const key = referenceSlot.value
  const kind = ({ skills: 'skill', marks: 'mark', behaviors: 'behavior' } as Record<string, string>)[
    referenceKind.value
  ]!
  const reference = { $ref: { projectId: props.projectId, kind, id } }
  let useId = id,
    suffix = 2
  while (list(key).some(entry => object(entry) && entry.useId === useId)) useId = `${id}-${suffix++}`
  const value: Json =
    key === 'learnable_skills'
      ? { skill_id: reference, level: 1, hidden: false }
      : key === 'behaviors'
        ? { definitionId: reference, useId }
        : reference
  change(key, [...list(key), value])
  picking.value = false
}
const mediaOptions = computed(() =>
  props.assets
    .filter(file => {
      const path = file.split('?')[0] ?? file
      return /cry|sfx/.test(mediaPick.value)
        ? /\.(mp3|ogg)$/i.test(path)
        : mediaPick.value === 'battle.source'
          ? /\.(png|jpe?g|webp|swf)$/i.test(path)
          : /\.(png|jpe?g|webp)$/i.test(path)
    })
    .map(file => ({
      id: file,
      label: file.split('/').at(-1)?.split('?')[0] || file,
      detail: /^https?:/.test(file) ? '远程资源 · ' + file : file,
    })),
)
function chooseMedia(file: string) {
  const path = `presentation.${mediaPick.value}`
  if (locked(path)) return
  selectionError.value = ''
  if (mediaPick.value === 'battle.source') {
    const renderer = /\.swf(?:\?|$)/i.test(file) ? 'seer2-swf' : 'image'
    if (locked('presentation.battle.renderer') && text('presentation.battle.renderer') !== renderer) {
      selectionError.value = '此资源需要另一种战斗表现方式，但该设置来自共享配置，请在外部修改。'
      return
    }
    const record = clone(props.record)
    const presentation = object(record.presentation) ? record.presentation : {}
    const battle = object(presentation.battle) ? presentation.battle : {}
    record.presentation = { ...presentation, battle: { ...battle, source: file, renderer } }
    emit('change', record)
  } else change(path, file)
  mediaPick.value = ''
}
function learning(index: number, key: string, value: Json) {
  change(
    'learnable_skills',
    list('learnable_skills').map((entry, at) => (at === index && object(entry) ? { ...entry, [key]: value } : entry)),
  )
}
const media = computed(() =>
  props.kind === 'species'
    ? { icon: '图标', portrait: '肖像', 'battle.source': '战斗素材', 'battle.fallback': '备用图片', cry: '叫声' }
    : props.kind === 'skills'
      ? { sfx: '技能音效' }
      : { icon: '印记图标' },
)
</script>
<template>
  <p v-if="selectionError" role="alert">{{ selectionError }}</p>
  <p v-if="problem" role="alert">{{ problem }} <button @click="emit('external')">打开源文件</button></p>
  <details v-if="sharedFields?.length" class="sharing">
    <summary>有 {{ sharedFields.length }} 处共享配置，在此只读</summary>
    <ul>
      <li v-for="field in sharedFields" :key="JSON.stringify(field.path)">
        <span>{{ fieldLabel(field.path) }} · {{ field.anchor || '共享配置' }}</span
        ><button @click="emit('external', field.line, field.column)">打开定义 ↗</button>
      </li>
    </ul>
  </details>
  <fieldset :disabled="!!problem" class="record-form">
    <template v-if="visible('base')">
      <div class="fields">
        <label v-if="!hideIdentity"
          >名称<input
            :disabled="locked('name')"
            :value="text('name')"
            @input="change('name', ($event.target as HTMLInputElement).value)"
        /></label>
        <label v-if="kind !== 'marks'"
          >属性<select
            :disabled="locked('element')"
            :value="text('element')"
            @change="change('element', ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="element in Object.values(Element)" :key="element">{{ element }}</option>
          </select></label
        >
        <label v-if="kind === 'skills'"
          >类别<select
            :disabled="locked('category')"
            :value="text('category')"
            @change="change('category', ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="category in ['Physical', 'Special', 'Status', 'Climax']" :key="category">
              {{ category }}
            </option>
          </select></label
        >
        <label
          >标签<input
            :value="list('tags').join(', ')"
            :disabled="locked('tags')"
            placeholder="用逗号分隔"
            @change="
              change(
                'tags',
                ($event.target as HTMLInputElement).value
                  .split(/[,，]/)
                  .map(tag => tag.trim())
                  .filter(Boolean),
              )
            "
        /></label>
      </div>
      <h3>{{ kind === 'species' ? '种族值' : kind === 'skills' ? '技能数值' : '印记配置' }}</h3>
      <div class="fields">
        <label v-for="(label, key) in numeric" :key="key"
          >{{ label }}<input :disabled="locked(key)" type="number" :value="text(key)" @input="number(key, $event)"
        /></label>
        <label v-if="kind === 'marks'" class="check"
          ><input
            type="checkbox"
            :disabled="locked('config.stackable')"
            :checked="get('config.stackable') === true"
            @change="change('config.stackable', ($event.target as HTMLInputElement).checked)"
          />允许叠层</label
        >
      </div>
    </template>
    <template v-if="visible('references')">
      <h3>{{ kind === 'species' ? '学习技能、特性与纹章' : '效果引用' }}</h3>
      <section
        v-for="key in kind === 'species' ? ['learnable_skills', 'ability', 'emblem'] : ['behaviors']"
        :key="key"
        class="reference-group"
      >
        <header>
          <strong>{{
            { learnable_skills: '学习技能', ability: '特性', emblem: '纹章', behaviors: '效果' }[key]
          }}</strong
          ><button :disabled="locked(key)" @click="pickReference(key)">
            关联已有{{ key === 'learnable_skills' ? '技能' : key === 'behaviors' ? '效果' : '印记' }}…
          </button>
        </header>
        <div v-for="(item, index) in list(key)" :key="index" class="reference">
          <button
            class="reference-name"
            :disabled="!target(referenceValue(item, key), key)"
            @click="openReference(referenceValue(item, key), key)"
          >
            {{ referenceLabel(referenceValue(item, key), key) }} ↗
          </button>
          <template v-if="key === 'learnable_skills' && object(item)"
            ><label
              >学习等级<input
                type="number"
                :disabled="locked(key)"
                :value="item.level"
                min="1"
                @change="learning(index, 'level', Number(($event.target as HTMLInputElement).value))" /></label
            ><label class="check"
              ><input
                type="checkbox"
                :disabled="locked(key)"
                :checked="item.hidden === true"
                @change="learning(index, 'hidden', ($event.target as HTMLInputElement).checked)"
              />隐藏</label
            ></template
          >
          <button
            :disabled="locked(key)"
            @click="
              change(
                key,
                list(key).filter((_, at) => at !== index),
              )
            "
          >
            移除关联
          </button>
        </div>
        <p v-if="!list(key).length" class="hint">尚未关联</p>
        <ChoicePicker
          v-if="picking && referenceSlot === key"
          :label="key === 'learnable_skills' ? '选择技能' : key === 'behaviors' ? '选择效果' : '选择印记'"
          :options="options"
          @choose="addReference"
          @cancel="picking = false"
        />
      </section>
      <p class="hint">编辑关联内容会影响它的所有使用者。效果代码可在外部编辑器修改。</p>
    </template>
    <template v-if="visible('media')">
      <h3>形象与声音</h3>
      <label v-if="kind === 'species'"
        >战斗表现<select
          :disabled="locked('presentation.battle.renderer')"
          :value="text('presentation.battle.renderer')"
          @change="change('presentation.battle.renderer', ($event.target as HTMLSelectElement).value)"
        >
          <option value="">请选择</option>
          <option value="image">图片</option>
          <option value="seer2-swf">赛尔号 2 SWF</option>
        </select></label
      >
      <section v-for="(label, key) in media" :key="key" class="media-slot">
        <header>
          <strong>{{ label }}</strong>
          <div class="tools">
            <button
              v-if="typeof get(`presentation.${key}`) === 'string'"
              @click="emit('preview', String(get(`presentation.${key}`)))"
            >
              预览</button
            ><button :disabled="locked(`presentation.${key}`)" @click="mediaPick = key">选择已有资源…</button
            ><button
              v-if="get(`presentation.${key}`) !== undefined"
              :disabled="locked(`presentation.${key}`)"
              @click="change(`presentation.${key}`, undefined)"
            >
              清除关联
            </button>
          </div>
        </header>
        <p class="hint">
          {{
            text(`presentation.${key}`)?.split('/').at(-1) ||
            (object(get(`presentation.${key}`)) ? '跨包资源引用' : '尚未关联')
          }}
        </p>
        <ChoicePicker
          v-if="mediaPick === key"
          :label="`选择${label}`"
          :options="mediaOptions"
          @choose="chooseMedia"
          @cancel="mediaPick = ''"
        />
      </section>
    </template>
    <button class="external" @click="emit('external')">在外部编辑器打开源文件 ↗</button>
  </fieldset>
</template>
<style scoped>
.record-form {
  border: 0;
  padding: 0;
  min-width: 0;
}
.fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 160px), 1fr));
  gap: 16px;
}
label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
}
.check {
  flex-direction: row;
  align-items: center;
}
input,
select {
  font: inherit;
  color: inherit;
  border: 1px solid var(--author-border, #dce4dd);
  border-radius: 8px;
  padding: 10px;
  min-width: 0;
  background: var(--author-bg, #f8faf8);
}
input:disabled,
select:disabled {
  opacity: 0.6;
}
input[type='checkbox'] {
  width: auto;
}
h3 {
  font-size: 16px;
  margin: 22px 0 14px;
  font-weight: 500;
}
.reference-group,
.media-slot {
  padding: 14px 0;
  border-bottom: 1px solid var(--author-border, #dce4dd);
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
header strong {
  font-weight: 500;
}
.reference {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 12px 0;
}
.reference-name {
  flex: 1;
  text-align: left;
  min-width: 100px;
}
.reference input[type='number'] {
  width: 75px;
}
.hint {
  color: var(--author-muted, #647267);
  font-size: 12px;
  overflow-wrap: anywhere;
}
button {
  font: inherit;
  padding: 8px 12px;
  border: 1px solid var(--author-border, #dce4dd);
  border-radius: 8px;
  background: var(--author-panel, #fff);
  color: inherit;
}
button:disabled {
  opacity: 0.5;
}
.external {
  margin-top: 20px;
  font-size: 12px;
}
.tools {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.sharing {
  padding: 12px;
  margin-bottom: 16px;
  background: var(--author-soft, #eef3ee);
  border-radius: 8px;
  font-size: 12px;
}
.sharing li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.sharing ul {
  padding-left: 10px;
}
</style>
