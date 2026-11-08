<script setup lang="ts">
import { ElMenu, ElMenuItem, ElBadge, ElIcon } from 'element-plus'
import { House, Box, Connection, User, Setting, Tickets, Lock, Key } from '@element-plus/icons-vue'
import type { ManagementTab } from './useManagementController'
defineProps<{ tab: ManagementTab; available: ManagementTab[]; activeOperations: number }>()
const emit = defineEmits<{ select: [tab: ManagementTab] }>()
const items = [
  { id: 'server', label: '概览', icon: House },
  { id: 'environments', label: '运行环境', icon: Box },
  { id: 'battles', label: '活跃对战', icon: Connection },
  { id: 'accounts', label: '用户管理', icon: User },
  { id: 'network', label: '网络与容量', icon: Setting },
  { id: 'tasks', label: '操作记录与备份', icon: Tickets },
  { id: 'permissions', label: '访问权限', icon: Lock },
  { id: 'security', label: '登录与安全', icon: Key },
] as const
</script>
<template>
  <ElMenu class="management-menu" :default-active="tab" aria-label="管理功能">
    <ElMenuItem
      v-for="item in items.filter(item => available.includes(item.id))"
      :key="item.id"
      :index="item.id"
      :aria-current="tab === item.id ? 'page' : undefined"
      @click="emit('select', item.id)"
    >
      <ElIcon>
        <component :is="item.icon" />
      </ElIcon>
      <span>{{ item.label }}</span>
      <ElBadge v-if="item.id === 'tasks' && activeOperations" :value="activeOperations" class="task-count" />
    </ElMenuItem>
  </ElMenu>
</template>
