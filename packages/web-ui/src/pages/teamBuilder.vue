<script setup lang="ts">
import { computed } from 'vue'
import RoomTeamEditor from '@/components/team/RoomTeamEditor.vue'
import { useRoute } from 'vue-router'
import PersonalEnvironmentView from '@/components/team/PersonalEnvironmentView.vue'
const route = useRoute()
const roomCode = computed(() => (typeof route.query.roomCode === 'string' ? route.query.roomCode : ''))
</script>

<template>
  <div>
    <RoomTeamEditor v-if="route.name === 'TeamBuilder' && roomCode" :key="roomCode" :room-code="roomCode" />
    <PersonalEnvironmentView v-else :warehouse="route.name === 'StorageManager'" />
  </div>
</template>
