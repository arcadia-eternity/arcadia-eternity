<template>
  <el-container class="app-container" direction="vertical">
    <!-- 全局导航栏 -->
    <el-header class="main-header" height="60px">
      <div class="logo">
        <img src="@/assets/logo.svg" alt="赛尔号对战" class="logo-img" />
        <span class="title">赛尔号网络对战</span>
      </div>
      <div class="nav-buttons">
        <el-button type="primary" icon="House" @click="router.push('/')" :disabled="$route.path === '/'">
          匹配大厅
        </el-button>
        <el-button
          type="warning"
          icon="Edit"
          @click="router.push('/team-builder')"
          :disabled="$route.path === '/team-builder'"
        >
          队伍编辑
        </el-button>
        <el-button type="success" icon="Promotion" @click="handleReconnect" v-if="$route.path === '/battle'">
          重连对战
        </el-button>
      </div>
    </el-header>

    <!-- 路由视图 -->
    <router-view v-slot="{ Component }">
      <transition name="fade" mode="out-in">
        <component :is="Component" />
      </transition>
    </router-view>

    <!-- 全局状态提示 -->
    <el-affix position="bottom" :offset="20">
      <div class="connection-status">
        <el-tag :type="connectionState === 'connected' ? 'success' : 'danger'" effect="dark" round>
          <el-icon :size="14">
            <Connection />
          </el-icon>
          {{ connectionState === 'connected' ? '已连接' : '未连接' }}
        </el-tag>
      </div>
    </el-affix>
  </el-container>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { battleClient } from './utils/battleClient'
import { useGameDataStore } from './stores/gameData'
import { usePlayerStore } from './stores/player'
import { usePetStorageStore } from './stores/petStorage'

const router = useRouter()
const route = useRoute()
const dataStore = useGameDataStore()
const playerStore = usePlayerStore()
const petStorage = usePetStorageStore()

// 连接状态
const connectionState = ref<'connected' | 'disconnected'>('disconnected')

// 初始化连接
onMounted(async () => {
  dataStore.initialize()
  playerStore.loadFromLocal()
  petStorage.loadFromLocal()
  try {
    await battleClient.connect()
    connectionState.value = 'connected'
  } catch (err) {
    ElMessage.error('连接服务器失败')
  }
})

// 重连处理
const handleReconnect = async () => {
  try {
    await battleClient.disconnect()
    await battleClient.connect()
    ElMessage.success('重新连接成功')
    connectionState.value = 'connected'
  } catch (err) {
    ElMessage.error('重连失败')
  }
}
</script>

<style scoped>
.app-container {
  background: url('@/assets/bg-stars.jpg') no-repeat center/cover;
}

.main-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: rgba(0, 0, 0, 0.8);
  border-bottom: 1px solid #304156;
}

.router-content {
  height: 100%;
  min-height: calc(100vh - 60px);
}

.connection-status {
  position: absolute;
  right: 20px;
  bottom: 20px;
  z-index: 1000;
}

.logo {
  display: flex;
  align-items: center;
  gap: 12px;
}

.logo-img {
  height: 40px;
}

.title {
  color: #fff;
  font-size: 1.5rem;
  font-weight: bold;
  text-shadow: 0 0 8px #409eff;
}

.nav-buttons {
  display: flex;
  gap: 12px;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
