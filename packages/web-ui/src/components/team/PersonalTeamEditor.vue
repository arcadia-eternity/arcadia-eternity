<script setup lang="ts">
import type { PetOrigin } from '@arcadia-eternity/local-profile'
import UnresolvedSpecies from './UnresolvedSpecies.vue'
import TeamEditor from './TeamEditor.vue'
import { usePersonalTeamEditor } from './personalDelegate'

const props = defineProps<{ unavailable: string; environmentBusy: boolean; creationOrigin?: PetOrigin }>()
const delegate = usePersonalTeamEditor(() => props.creationOrigin)
</script>

<template>
  <div>
    <el-card v-if="unavailable" class="m-4" shadow="never">
      <template #header><h1 class="font-medium">队伍编辑器</h1></template>
      <el-alert :title="unavailable" type="warning" show-icon :closable="false" />
      <ol class="my-3 list-decimal pl-6 space-y-2">
        <li v-for="pet in delegate.team.value" :key="pet.id">
          {{ pet.name }}
          <UnresolvedSpecies :species="pet.species" :origin="delegate.originFor?.(pet)" unavailable />
        </li>
      </ol>
      <slot name="environment" />
      <el-button @click="delegate.exportTeam?.(delegate.team.value)">导出队伍</el-button>
    </el-card>
    <TeamEditor v-else :delegate="delegate" :environment-busy="environmentBusy">
      <template #environment><slot name="environment" /></template>
    </TeamEditor>
  </div>
</template>
