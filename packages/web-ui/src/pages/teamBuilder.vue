<script setup lang="ts">
import { computed } from 'vue'
import RoomTeamEditor from '@/components/team/RoomTeamEditor.vue'
import { useRoute } from 'vue-router'
import PersonalTeamEditor from '@/components/team/PersonalTeamEditor.vue'
const route = useRoute()
const roomCode = computed(() => (typeof route.query.roomCode === 'string' ? route.query.roomCode : ''))
</script>

<template>
  <div>
    <RoomTeamEditor v-if="roomCode" :key="roomCode" :room-code="roomCode" />
    <PersonalTeamEditor v-else />
  </div>
</template>
