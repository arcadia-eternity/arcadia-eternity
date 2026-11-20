<script setup lang="ts">
import TeamEditor from './TeamEditor.vue'
import { usePersonalTeamEditor } from './personalDelegate'

defineProps<{ unavailable: string; environmentBusy: boolean }>()
const delegate = usePersonalTeamEditor()
</script>

<template>
  <div>
    <el-card v-if="unavailable" class="m-4" shadow="never">
      <template #header><h1 class="font-medium">队伍编辑器</h1></template>
      <el-alert :title="unavailable" type="warning" show-icon :closable="false" />
      <ul class="my-3">
        <li v-for="pet in delegate.team.value" :key="pet.id">{{ pet.name }} · {{ pet.species }}</li>
      </ul>
      <slot name="environment" />
      <el-button @click="delegate.exportTeam?.(delegate.team.value)">导出队伍</el-button>
    </el-card>
    <TeamEditor v-else :delegate="delegate" :environment-busy="environmentBusy">
      <template #environment><slot name="environment" /></template>
    </TeamEditor>
  </div>
</template>
