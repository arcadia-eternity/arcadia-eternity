import { defineStore } from 'pinia'
import { ref } from 'vue'

import type { ServerState } from '@arcadia-eternity/protocol'
import { battleClient } from '@/utils/battleClient'

export const useServerStateStore = defineStore('serverState', () => {
  const serverState = ref<ServerState>({
    onlinePlayers: 0,
    matchmakingQueue: 0,
    rooms: 0,
    playersInRooms: 0,
  })

  battleClient.on('updateState', (state: ServerState) => {
    serverState.value = state
  })

  const updateServerState = (state: ServerState) => {
    serverState.value = state
  }

  return {
    serverState,
    updateServerState,
  }
})
