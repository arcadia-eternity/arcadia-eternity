<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { parse } from 'yaml'
import { Value } from '@sinclair/typebox/value'
import { environmentCapabilities } from '@arcadia-eternity/content-sdk/environment-rules'
import type { PetSchemaType, TeamPetPreset } from '@arcadia-eternity/schema'
import { useGameDataStore } from '@/stores/gameData'
import { findMissingTeamContent } from '@/utils/teamContent'
import { teamIssues } from '@/utils/basicTeamValidation'
import { buildDifferences, buildStatSteps, statNames, statList } from '@/utils/teamBuildComparison'
import { capturePetPreset, previewPetPreset, readPetPreset } from './buildPreset'

const props = defineProps<{ pet: PetSchemaType; team: PetSchemaType[] }>()
const emit = defineEmits<{ apply: [pet: PetSchemaType] }>()
const game = useGameDataStore()
const preset = shallowRef<TeamPetPreset>()
const error = ref('')
const undo = shallowRef<{ before: PetSchemaType; after: PetSchemaType }>()
let request = 0
watch([() => props.pet.id, () => game.species, () => game.rules], () => {
  request++
  preset.value = undefined
  undo.value = undefined
  error.value = ''
})

async function load(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const generation = ++request
  error.value = ''
  preset.value = undefined
  try {
    const content = readPetPreset(parse(await file.text(), { strict: true, maxAliasCount: 100 }))
    if (generation === request) preset.value = content
  } catch (cause) {
    if (generation === request) error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

function download() {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(
    new Blob([JSON.stringify(capturePetPreset(props.pet), null, 2)], { type: 'application/json' }),
  )
  link.download = props.pet.name + '.preset.json'
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 0)
}

const preview = computed(() => {
  if (!preset.value) return
  try {
    const current = props.pet
    const next = previewPetPreset(current, preset.value)
    const differences = buildDifferences(current, next)
    const before = buildStatSteps(current, game)
    const after = buildStatSteps(next, game)
    const stats = statList.map(key => `${statNames[key]} ${before[key]?.total ?? '—'} → ${after[key]?.total ?? '—'}`)
    const fields = preset.value.fields
    const blockers = findMissingTeamContent([next], game)
      .filter(item => item.kind === 'species' || Object.hasOwn(fields, item.kind === 'skill' ? 'skills' : item.kind))
      .map(item => item.message)
    const required = preset.value.requiredContent ?? {}
    const lookups = {
      species: game.getSpecies,
      skills: game.getSkill,
      marks: game.getMark,
      natures: game.getNature,
      enhancements: game.getEnhancement,
    }
    for (const key of Object.keys(required) as (keyof typeof required)[]) {
      for (const id of required[key] ?? []) if (!lookups[key](id)) blockers.push('缺少预设依赖 · ' + id)
    }
    for (const capability of preset.value.capabilities ?? []) {
      if (!environmentCapabilities.includes(capability)) blockers.push('当前版本不支持 · ' + capability)
    }
    const baseline = new Set(teamIssues(props.team, game).map(issue => issue.message))
    const issues = new Set(
      teamIssues(
        props.team.map(pet => (pet.id === current.id ? next : pet)),
        game,
      ).map(issue => issue.message),
    )
    const changes = [...issues].map(issue => (baseline.has(issue) ? issue : '新增问题 · ' + issue))
    changes.push(...[...baseline].filter(issue => !issues.has(issue)).map(issue => '已解决 · ' + issue))
    return { next, differences, stats, issues: changes, draft: issues.size > 0, blockers }
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : String(cause) }
  }
})
const canUndo = computed(() => !!undo.value && Value.Equal(undo.value.after, props.pet))
function apply() {
  const outcome = preview.value
  if (!outcome?.next || outcome.blockers?.length || !outcome.differences?.length) return
  undo.value = { before: Value.Clone(props.pet), after: Value.Clone(outcome.next) }
  emit('apply', outcome.next)
  preset.value = undefined
}
function restore() {
  if (!canUndo.value || !undo.value) return
  emit('apply', Value.Clone(undo.value.before))
  undo.value = undefined
}
</script>

<template>
  <details class="rounded border bg-white p-3">
    <summary>单宠预设</summary>
    <div class="mt-2 flex flex-wrap items-center gap-3">
      <label>导入预设 <input type="file" accept=".json,.yaml,.yml" @change="load" /></label>
      <button type="button" @click="download">导出当前配法</button>
      <button v-if="canUndo" type="button" @click="restore">撤销预设</button>
    </div>
    <p v-if="error || preview?.error" role="alert">{{ error || preview?.error }}</p>
    <template v-if="preview?.next">
      <h4>{{ preset?.name }}</h4>
      <ul aria-label="预设改动">
        <li v-for="change in preview.differences" :key="change">{{ change }}</li>
      </ul>
      <p v-if="!preview.differences.length">配法相同</p>
      <ul aria-label="预设能力值">
        <li v-for="stat in preview.stats" :key="stat">{{ stat }}</li>
      </ul>
      <ul v-if="preview.blockers.length" aria-label="预设依赖">
        <li v-for="reason in preview.blockers" :key="reason">{{ reason }}</li>
      </ul>
      <ul aria-label="整队检查">
        <li v-for="issue in preview.issues" :key="issue">{{ issue }}</li>
      </ul>
      <button type="button" :disabled="!!preview.blockers.length || !preview.differences.length" @click="apply">
        {{ preview.draft ? '应用为草稿' : '应用预设' }}
      </button>
      <button type="button" @click="preset = undefined">取消</button>
    </template>
  </details>
</template>
