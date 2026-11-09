<script setup lang="ts">
import { ElCard, ElButton, ElForm, ElFormItem, ElInput } from 'element-plus'
import type { ManagementController } from './useManagementController'

const { controller } = defineProps<{ controller: ManagementController }>()
const {
  server,
  bindings,
  players,
  busy,
  can,
  serverName,
  nameRevision,
  tab,
  conditionLabels,
  reason,
  supported,
  saveServerName,
  drain,
} = controller
</script>
<template>
  <section v-if="tab === 'server' && server" aria-label="服务器管理">
    <div class="overview-stats">
      <ElButton @click="tab = 'environments'" native-type="button">
        <strong>{{ bindings.filter(item => item.enabled && item.condition === 'available').length }}</strong
        >运行环境
      </ElButton>
      <ElButton :disabled="!can('server', 'battles.read')" @click="tab = 'battles'" native-type="button">
        <strong>{{ server.activeBattles ?? '—' }}</strong
        >活跃对战
      </ElButton>
      <ElButton :disabled="!can('server', 'players.read')" @click="tab = 'accounts'" native-type="button">
        <strong>{{ can('server', 'players.read') ? players.filter(item => item.connected).length : '—' }}</strong
        >在线玩家
      </ElButton>
      <div>
        <strong>{{ server.queued ?? '—' }}</strong
        >等待中的任务 / 匹配
      </div>
    </div>
    <ElCard shadow="never" class="server-summary">
      <h2>{{ server.name }}</h2>
      <p>
        {{ server.draining ? '正在排空：不接纳新局' : '正在接纳对局' }} ·
        {{ conditionLabels[server.status] ?? server.status }}
      </p>
      <ElForm class="actions" @submit.prevent="saveServerName" label-position="top">
        <ElFormItem label="服务器名称">
          <ElInput v-model="serverName" required maxlength="80" @input="nameRevision ??= server.revision" />
        </ElFormItem>
        <ElButton
          :disabled="busy || !can('server', 'settings.manage')"
          :title="reason('server', 'settings.manage')"
          native-type="submit"
        >
          保存名称</ElButton
        >
        <ElButton
          :disabled="busy || !supported('server.drain') || !can('server', 'drain')"
          :title="reason('server', 'drain')"
          @click="drain"
          native-type="button"
          >{{ server.draining ? '恢复接纳新局' : '停止接纳并排空' }}</ElButton
        >
      </ElForm>
    </ElCard>
  </section>
</template>
