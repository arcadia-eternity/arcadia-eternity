<template>
  <el-container class="app-container" direction="vertical">
    <!-- 全局导航栏 -->
    <el-header class="main-header" height="60px">
      <div class="logo">
        <img src="@/assets/logo.svg" alt="约瑟传说对战" class="logo-img" />
        <span class="title">约瑟传说网络对战</span>
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
        <el-button type="info" @click="showEditDialog = true">
          <el-icon><User /></el-icon>
          {{ player.name }}
        </el-button>
      </div>
    </el-header>

    <el-dialog v-model="showEditDialog" title="玩家信息设置" width="500px" destroy-on-close>
      <el-form label-width="80px">
        <el-form-item label="玩家名称">
          <el-input v-model="playerStore.name" placeholder="请输入玩家名称" maxlength="30" show-word-limit />
        </el-form-item>

        <el-form-item label="玩家ID">
          <div class="id-container">
            <span class="id-value">{{ playerStore.id }}</span>
            <el-button type="warning" plain @click="handleGenerateNewId"> 生成新ID </el-button>
          </div>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showEditDialog = false">取消</el-button>
        <el-button type="primary" @click="handleSave"> 保存更改 </el-button>
      </template>
    </el-dialog>

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
import { ref, onMounted, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { battleClient } from './utils/battleClient'
import { useGameDataStore } from './stores/gameData'
import { usePlayerStore } from './stores/player'
import { usePetStorageStore } from './stores/petStorage'

const router = useRouter()
const dataStore = useGameDataStore()
const playerStore = usePlayerStore()
const petStorage = usePetStorageStore()

// 连接状态
const connectionState = ref<'connected' | 'disconnected'>('disconnected')

// 初始化连接
onMounted(async () => {
  dataStore.initialize()
  petStorage.loadFromLocal()
  try {
    await battleClient.connect()
    connectionState.value = 'connected'
  } catch (err) {
    ElMessage.error('连接服务器失败')
  }
})

const showEditDialog = ref(false)

// 处理生成新ID
const handleGenerateNewId = () => {
  playerStore.generateNewId()
}

// 处理保存
const handleSave = () => {
  playerStore.saveToLocal()
  showEditDialog.value = false
  ElMessage.success('玩家信息已保存')
}

const player = computed(() => playerStore)
</script>

<style>
html,
body,
#app {
  height: 100vh;
  width: 100vw;
  margin: 0px;
}
</style>

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

.user-info {
  margin-left: auto;
  margin-right: 20px;
}

.id-container {
  display: flex;
  align-items: center;
  gap: 10px;
}

.id-value {
  flex: 1;
  color: #666;
  font-family: monospace;
  font-size: 0.9em;
}
</style>
