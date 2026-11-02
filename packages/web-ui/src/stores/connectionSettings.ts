import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { isDesktop, isStaticMode } from '@/utils/env'
import { readLocalData, writeLocalData } from '@/services/localStorage'

const STORAGE_KEY = 'connection.autoConnect'

export const useConnectionSettingsStore = defineStore('connectionSettings', () => {
  // Desktop's local workspace never initiates a server session on navigation.
  // Remote-play windows expose a different bridge and follow the web policy.
  const isLocalMode = isDesktop || isStaticMode
  const autoConnect = ref(readLocalData(STORAGE_KEY) !== 'false')
  const shouldAutoConnect = computed(() => !isLocalMode && autoConnect.value)
  watch(autoConnect, value => writeLocalData(STORAGE_KEY, String(value)), { flush: 'sync' })
  return { isLocalMode, autoConnect, shouldAutoConnect }
})
