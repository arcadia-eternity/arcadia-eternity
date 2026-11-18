<script setup lang="ts">
import TeamEditor from './TeamEditor.vue'
import PersonalEnvironmentView from './PersonalEnvironmentView.vue'
import { usePersonalTeamEditor } from './personalDelegate'

const delegate = usePersonalTeamEditor()
</script>

<template>
  <PersonalEnvironmentView>
    <TeamEditor :delegate="delegate" />
    <template #unresolved>
      <ul>
        <li v-for="pet in delegate.team.value" :key="pet.id">{{ pet.name }} · {{ pet.species }}</li>
      </ul>
      <button @click="delegate.exportTeam?.(delegate.team.value)">导出队伍</button>
    </template>
  </PersonalEnvironmentView>
</template>
