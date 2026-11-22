<template>
  <el-form-item label="对战方式">
    <el-radio-group v-model="battleMode">
      <el-radio value="server" :disabled="peerOnly">服务器对战</el-radio>
      <el-radio value="p2p" :disabled="serverOnly">房主运行对战</el-radio>
    </el-radio-group>
    <p v-if="battleMode === 'p2p'" class="text-xs text-gray-500 mt-2">房主需保持页面开启。P2P 对战不支持观战。</p>
  </el-form-item>
</template>

<script setup lang="ts">
const battleMode = defineModel<'server' | 'p2p'>({ required: true })
defineProps<{ serverOnly?: boolean; peerOnly?: boolean }>()
</script>
