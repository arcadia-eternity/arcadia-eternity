<script setup lang="ts">
import { gameplayName } from '@/i18n/environment'
import { computed, ref } from 'vue'
import i18next from 'i18next'
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
      <span class="font-medium"
        >{{ current.name }} <small class="text-gray-500">#{{ current.id.slice(-8) }}</small></span
      >
      <el-popover trigger="click" placement="bottom-start">
        <template #reference
          ><el-button link type="primary"
            >使用队伍（{{ warehouse.teamsUsing(current.id).length }}）</el-button
          ></template
        >
        <ul>
          <li v-for="team in warehouse.teamsUsing(current.id)" :key="team.id">{{ team.name }}</li>
        </ul>
      </el-popover>
      <el-button size="small" class="ml-auto" :aria-expanded="open" @click="open = !open">更换精灵</el-button>
    </div>
    <div v-if="open" class="mt-3 space-y-2">
      <div class="flex flex-wrap gap-3">
        <el-input
          v-model="query"
          clearable
          aria-label="搜索仓库精灵"
          placeholder="昵称、物种或编号"
          style="width: min(16rem, 100%)"
        />
        <el-checkbox v-model="allSpecies">全部物种</el-checkbox>
      </div>
      <el-radio-group v-model="selectedId" aria-label="仓库精灵" class="gap-x-3">
        <el-radio v-for="{ pet, issues: memberProblems } in visible" :key="pet.id" :value="pet.id">
          {{ pet.name }} · {{ pet.id.slice(-8) }} · {{ memberProblems[0]?.message ?? '单宠可用' }}
        </el-radio>
      </el-radio-group>
      <p v-if="!matches.length">没有符合条件的仓库精灵</p>
      <el-button v-if="matches.length > limit" link type="primary" @click="limit += 20">显示更多</el-button>
      <div v-if="selected" class="space-y-1">
        <p>
          {{ selected.name }} ·
          {{
            selected.skills
              .map(id => i18next.t(id + '.name', { ns: 'skill', nsSeparator: false, defaultValue: id }))
              .join('、')
          }}
          ·
          {{ gameplayName('nature', selected.nature, data.getNature(selected.nature)?.name) }}
        </p>
        <p>
          资质 {{ Object.values(selected.ivs).join(' / ')
          }}<template v-if="selected.enhancement">
            ·
            {{
              gameplayName('enhancement', selected.enhancement, data.getEnhancement(selected.enhancement)?.name)
            }}</template
          >
        </p>
        <ul v-if="issues.length">
          <li v-for="(issue, i) in issues" :key="i">{{ issue.message }}</li>
        </ul>
        <p v-else>替换后整队可用</p>
        <el-button type="primary" @click="replace">更换本队成员</el-button>
      </div>
    </div>
  </section>
</template>
