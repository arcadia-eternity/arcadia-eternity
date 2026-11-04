<script setup lang="ts">
import { computed, onBeforeMount } from 'vue'
import { useRoute } from 'vue-router'
import TeamEditor from '@/components/team/TeamEditor.vue'
import { usePersonalTeamEditor } from '@/components/team/personalDelegate'
import { getDesktopApi } from '@/utils/env'
import { useGameDataStore } from '@/stores/gameData'
const delegate = usePersonalTeamEditor()
const route = useRoute()
const roomCode = computed(() => (typeof route.query.roomCode === 'string' ? route.query.roomCode : ''))
onBeforeMount(() => {
  if (getDesktopApi() && !roomCode.value)
    void useGameDataStore()
      .reload()
      .catch(error => console.warn('本地内容加载失败', error))
})
</script>

<template>
  <div>
    <router-link v-if="roomCode" :to="`/room/${encodeURIComponent(roomCode)}`" class="text-sm text-blue-700"
      >返回房间</router-link
    ><TeamEditor :delegate="delegate" />
  </div>
</template>
