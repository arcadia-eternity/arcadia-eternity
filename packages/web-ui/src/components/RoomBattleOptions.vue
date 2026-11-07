<template>
  <el-form-item label="对战方式">
    <el-radio-group v-model="options.battleMode">
      <el-radio value="server">服务器对战</el-radio>
      <el-radio value="p2p" :disabled="serverOnly">房主运行对战</el-radio>
    </el-radio-group>
    <p v-if="options.battleMode === 'p2p'" class="text-xs text-gray-500 mt-2">
      房主需保持页面开启；当前不支持 P2P 对战观战。
    </p>
    <p v-else-if="serverOnly" class="text-xs text-gray-500 mt-2">此房间的内容由服务器运行。</p>
  </el-form-item>
  <el-form-item label="行动计时">
    <el-switch v-model="options.timerConfig.enabled" />
  </el-form-item>
  <template v-if="options.timerConfig.enabled">
    <el-form-item label="每回合秒数">
      <el-input-number v-model="options.timerConfig.turnTimeLimit" :min="1" :max="3600" :precision="0" />
    </el-form-item>
    <el-form-item label="总思考秒数">
      <el-input-number v-model="options.timerConfig.totalTimeLimit" :min="1" :max="86400" :precision="0" />
    </el-form-item>
  </template>
  <el-form-item label="倒下后换宠">
    <el-switch v-model="options.allowFaintSwitch" />
  </el-form-item>
  <el-form-item label="公开战斗信息">
    <el-switch v-model="options.showHidden" />
  </el-form-item>
</template>

<script setup lang="ts">
import type { RoomBattleOptionsValue } from '@/utils/roomBattleOptions'

const options = defineModel<RoomBattleOptionsValue>({ required: true })
defineProps<{ serverOnly?: boolean }>()
</script>
