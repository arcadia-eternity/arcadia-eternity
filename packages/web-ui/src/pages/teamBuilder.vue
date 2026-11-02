<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import TeamEditor from '@/components/team/TeamEditor.vue'
import { usePersonalTeamEditor } from '@/components/team/personalDelegate'
const delegate = usePersonalTeamEditor()
const route = useRoute()
const roomCode = computed(() => (typeof route.query.roomCode === 'string' ? route.query.roomCode : ''))
</script>

<template>
  <div>
    <router-link v-if="roomCode" :to="`/room/${encodeURIComponent(roomCode)}`" class="text-sm text-blue-700"
      >返回房间</router-link
    ><TeamEditor :delegate="delegate" />
  </div>
</template>
