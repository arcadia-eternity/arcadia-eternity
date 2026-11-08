<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ManagementConsole from './ManagementConsole.vue'
const route = useRoute()
const router = useRouter()
const target = computed(() => (route.query.target === 'server' ? 'server' : window.arcadiaDesktop ? 'local' : 'server'))
const tab = computed(() => {
  const value = route.query.tab
  return value === 'environments' ||
    value === 'network' ||
    value === 'battles' ||
    value === 'accounts' ||
    value === 'tasks' ||
    value === 'permissions' ||
    value === 'security'
    ? value
    : 'server'
})
</script>
<template>
  <ManagementConsole
    :key="target"
    :initial-target="target"
    :initial-tab="tab"
    @navigate="
      value => {
        if (value.target !== target || value.tab !== tab)
          router.push({ path: '/management', query: { target: value.target, tab: value.tab } })
      }
    "
  />
</template>
