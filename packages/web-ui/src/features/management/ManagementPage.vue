<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import ManagementConsole from './ManagementConsole.vue'
const route = useRoute()
const target = computed(() => (route.query.target === 'server' ? 'server' : window.arcadiaDesktop ? 'local' : 'server'))
const tab = computed(() =>
  route.query.tab === 'environments' ? 'environments' : route.query.tab === 'network' ? 'network' : 'server',
)
</script>
<template>
  <div>
    <div class="max-w-6xl mx-auto px-4 pt-5">
      <RouterLink to="/servers" class="text-blue-600">← 返回服务器</RouterLink>
    </div>
    <ManagementConsole :key="target + tab" :initial-target="target" :initial-tab="tab" />
  </div>
</template>
