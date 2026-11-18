<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PetSchemaType } from '@arcadia-eternity/schema'
import { useGameDataStore } from '@/stores/gameData'
import { memberIssues, teamIssues } from '@/utils/basicTeamValidation'
import type { TeamEditorDelegate } from './delegate'

const props = defineProps<{
  current: PetSchemaType
  team: PetSchemaType[]
  warehouse: NonNullable<TeamEditorDelegate['warehouse']>
}>()
const emit = defineEmits<{ replaced: [id: string] }>()
const data = useGameDataStore()
const open = ref(false)
const allSpecies = ref(false)
const query = ref('')
const limit = ref(20)
const selectedId = ref('')
const used = computed(() => new Set(props.team.map(pet => pet.id)))
const matches = computed(() => {
  if (!open.value) return []
  const text = query.value.trim().toLowerCase()
  return props.warehouse.pets.value.filter(
    pet =>
      !used.value.has(pet.id) &&
      (allSpecies.value || pet.species === props.current.species) &&
      (!text || [pet.name, pet.species, pet.id].some(value => value.toLowerCase().includes(text))),
  )
})
const visible = computed(() =>
  matches.value.slice(0, limit.value).map(pet => ({ pet, issues: memberIssues(pet, data) })),
)
const selected = computed(() => visible.value.find(row => row.pet.id === selectedId.value)?.pet)
const issues = computed(() =>
  selected.value
    ? teamIssues(
        props.team.map(pet => (pet.id === props.current.id ? selected.value! : pet)),
        data,
      )
    : [],
)
function replace() {
  const pet = selected.value
  if (pet && props.warehouse.replace(props.current.id, pet.id)) emit('replaced', pet.id)
}
</script>

<template>
  <section class="rounded-lg border bg-white p-3">
    <div class="flex flex-wrap items-center gap-2">
      <span>当前成员 · {{ current.name }} · {{ current.id.slice(-8) }}</span>
      <details>
        <summary>使用队伍（{{ warehouse.teamsUsing(current.id).length }}）</summary>
        <ul>
          <li v-for="team in warehouse.teamsUsing(current.id)" :key="team.id">{{ team.name }}</li>
        </ul>
      </details>
      <button type="button" class="ml-auto" :aria-expanded="open" @click="open = !open">更换精灵</button>
    </div>
    <div v-if="open" class="mt-3 space-y-2">
      <input v-model="query" aria-label="搜索仓库精灵" placeholder="昵称、物种或编号" class="border rounded px-2" />
      <label><input v-model="allSpecies" type="checkbox" /> 全部物种</label>
      <ul>
        <li v-for="{ pet, issues: memberProblems } in visible" :key="pet.id">
          <label
            ><input v-model="selectedId" type="radio" :value="pet.id" /> {{ pet.name }} · {{ pet.id.slice(-8) }} ·
            {{ memberProblems[0]?.message ?? '单宠可用' }}
          </label>
        </li>
      </ul>
      <p v-if="!matches.length">没有符合条件的仓库精灵</p>
      <button v-if="matches.length > limit" type="button" @click="limit += 20">显示更多</button>
      <div v-if="selected" class="space-y-1">
        <p>
          {{ selected.name }} · {{ selected.skills.join('、') }} ·
          {{ data.getNature(selected.nature)?.name ?? selected.nature }}
        </p>
        <p>
          资质 {{ Object.values(selected.ivs).join(' / ')
          }}<template v-if="selected.enhancement">
            · {{ data.getEnhancement(selected.enhancement)?.name ?? selected.enhancement }}</template
          >
        </p>
        <ul v-if="issues.length">
          <li v-for="(issue, i) in issues" :key="i">{{ issue.message }}</li>
        </ul>
        <p v-else>替换后整队可用</p>
        <button type="button" @click="replace">更换本队成员</button>
      </div>
    </div>
  </section>
</template>
