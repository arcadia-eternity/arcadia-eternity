<template>
  <div class="h-screen flex flex-col">
    <!-- 移动端优先的导航栏 - 固定置顶 -->
    <header
      class="sticky top-0 z-40 bg-black/90 border-b border-gray-600 backdrop-blur-md"
      :class="isMobile ? 'h-14' : 'h-15'"
    >
      <!-- 移动端导航 -->
      <div v-if="isMobile" class="flex justify-between items-center px-4 h-full">
        <div class="flex items-center gap-3">
          <button
            @click="showMobileMenu = !showMobileMenu"
            class="bg-transparent border-none text-white p-2 rounded-md cursor-pointer transition-colors hover:bg-white/10"
          >
            <el-icon :size="20">
              <Menu />
            </el-icon>
          </button>
          <div class="flex items-center gap-2">
            <img src="@/assets/logo.png" alt="AE" class="h-7 w-7" />
            <span class="text-white text-lg font-bold" style="text-shadow: 0 0 8px #409eff">AE</span>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <el-tag type="info" effect="dark" class="text-xs" size="small">
            <el-icon :size="12"><User /></el-icon>
            {{ serverState.serverState.onlinePlayers }}
          </el-tag>
          <el-button type="default" size="small" @click="showEditDialog = true" class="min-w-0 p-2">
            <el-icon><Setting /></el-icon>
          </el-button>
        </div>
      </div>

      <!-- 桌面端导航 -->
      <div v-else class="flex justify-between items-center px-6 h-full">
        <div class="flex items-center gap-3">
          <img src="@/assets/logo.png" alt="Arcadia Eternity" class="h-10" />
          <span class="text-white text-2xl font-bold" style="text-shadow: 0 0 8px #409eff">Arcadia Eternity</span>
        </div>
        <div class="flex gap-3 items-center">
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
          <el-button
            type="success"
            icon="MagicStick"
            @click="router.push('/local-battle')"
            :disabled="$route.path === '/local-battle'"
          >
            本地测试
          </el-button>
          <el-dropdown @command="handleBattleReportCommand">
            <el-button type="info" icon="Document">
              战报
              <el-icon class="el-icon--right">
                <ArrowDown />
              </el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="online-reports" icon="Document">在线战报</el-dropdown-item>
                <el-dropdown-item command="local-reports" icon="FolderOpened">本地战报</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-tag type="info" effect="dark">
            <el-icon><User /></el-icon>
            在线人数：{{ serverState.serverState.onlinePlayers }}
          </el-tag>

          <el-button type="default" @click="showEditDialog = true" size="small">
            <el-icon><Setting /></el-icon>
            设置
          </el-button>
        </div>
      </div>
    </header>

    <!-- 移动端侧边菜单 -->
    <el-drawer v-model="showMobileMenu" direction="ltr" :size="280" :with-header="false">
      <div class="h-full flex flex-col bg-white">
        <div class="flex justify-between items-center p-4 border-b border-gray-200 bg-gray-50">
          <div class="flex items-center gap-3">
            <img src="@/assets/logo.png" alt="Arcadia Eternity" class="h-8 w-8" />
            <span class="text-xl font-bold text-gray-800">Arcadia Eternity</span>
          </div>
          <button
            @click="showMobileMenu = false"
            class="bg-transparent border-none text-gray-500 p-2 rounded-md cursor-pointer transition-colors hover:bg-black/5"
          >
            <el-icon :size="20">
              <Close />
            </el-icon>
          </button>
        </div>

        <nav class="flex-1 py-5">
          <router-link
            to="/"
            @click="showMobileMenu = false"
            class="flex items-center gap-4 px-6 py-4 text-gray-600 no-underline text-base font-medium transition-all border-l-4 border-transparent hover:bg-gray-100 hover:text-gray-800"
            :class="{ 'bg-blue-50 text-blue-600 border-l-blue-600': $route.path === '/' }"
          >
            <el-icon><House /></el-icon>
            <span>匹配大厅</span>
          </router-link>
          <router-link
            to="/team-builder"
            @click="showMobileMenu = false"
            class="flex items-center gap-4 px-6 py-4 text-gray-600 no-underline text-base font-medium transition-all border-l-4 border-transparent hover:bg-gray-100 hover:text-gray-800"
            :class="{ 'bg-blue-50 text-blue-600 border-l-blue-600': $route.path === '/team-builder' }"
          >
            <el-icon><Edit /></el-icon>
            <span>队伍编辑</span>
          </router-link>
          <router-link
            to="/local-battle"
            @click="showMobileMenu = false"
            class="flex items-center gap-4 px-6 py-4 text-gray-600 no-underline text-base font-medium transition-all border-l-4 border-transparent hover:bg-gray-100 hover:text-gray-800"
            :class="{ 'bg-blue-50 text-blue-600 border-l-blue-600': $route.path === '/local-battle' }"
          >
            <el-icon><MagicStick /></el-icon>
            <span>本地测试</span>
          </router-link>
          <router-link
            to="/storage"
            @click="showMobileMenu = false"
            class="flex items-center gap-4 px-6 py-4 text-gray-600 no-underline text-base font-medium transition-all border-l-4 border-transparent hover:bg-gray-100 hover:text-gray-800"
            :class="{ 'bg-blue-50 text-blue-600 border-l-blue-600': $route.path === '/storage' }"
          >
            <el-icon><Box /></el-icon>
            <span>精灵仓库</span>
          </router-link>
          <router-link
            to="/battle-reports"
            @click="showMobileMenu = false"
            class="flex items-center gap-4 px-6 py-4 text-gray-600 no-underline text-base font-medium transition-all border-l-4 border-transparent hover:bg-gray-100 hover:text-gray-800"
            :class="{ 'bg-blue-50 text-blue-600 border-l-blue-600': $route.path === '/battle-reports' }"
          >
            <el-icon><Document /></el-icon>
            <span>战报记录</span>
          </router-link>
          <router-link
            to="/local-battle-reports"
            @click="showMobileMenu = false"
            class="flex items-center gap-4 px-6 py-4 text-gray-600 no-underline text-base font-medium transition-all border-l-4 border-transparent hover:bg-gray-100 hover:text-gray-800"
            :class="{ 'bg-blue-50 text-blue-600 border-l-blue-600': $route.path === '/local-battle-reports' }"
          >
            <el-icon><FolderOpened /></el-icon>
            <span>本地战报</span>
          </router-link>
        </nav>

        <div class="p-5 border-t border-gray-200 bg-gray-50">
          <div>
            <el-button
              type="default"
              @click="
                () => {
                  showEditDialog = true
                  showMobileMenu = false
                }
              "
              class="w-full"
              size="small"
            >
              <el-icon><Setting /></el-icon>
              <span class="ml-2">游戏设置</span>
            </el-button>
          </div>
        </div>
      </div>
    </el-drawer>

    <!-- 移动端优化的设置对话框 -->
    <el-dialog
      v-model="showEditDialog"
      title="游戏设置"
      :width="isMobile ? '95%' : '500px'"
      :fullscreen="isMobile"
      destroy-on-close
      :class="isMobile ? 'mobile-dialog' : ''"
    >
      <el-form :label-width="isMobile ? '70px' : '80px'" :class="isMobile ? 'mobile-form' : ''">
        <el-form-item label="账户管理">
          <el-button type="primary" :size="isMobile ? 'large' : 'default'" @click="navigateToAccount" class="w-full">
            <el-icon class="mr-2"><User /></el-icon>
            管理账户信息
          </el-button>
        </el-form-item>

        <el-divider content-position="center">游戏设置</el-divider>
        <el-form-item label="背景图片">
          <el-select
            v-model="gameSettingStore.background"
            placeholder="请选择背景图片"
            style="width: 100%"
            :size="isMobile ? 'large' : 'default'"
          >
            <el-option label="随机" value="random" />
            <el-option v-for="item in backgroundOptions" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>

        <el-form-item label="战斗音乐">
          <el-select
            v-model="gameSettingStore.battleMusic"
            placeholder="请选择战斗音乐"
            style="width: 100%"
            :size="isMobile ? 'large' : 'default'"
          >
            <el-option label="随机" value="random" />
            <el-option v-for="item in musicOptions" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>

        <el-form-item label="音乐音量">
          <div
            class="flex items-center gap-4 w-full md:flex-row"
            :class="isMobile ? 'flex-col items-stretch gap-3' : ''"
          >
            <el-slider
              v-model="gameSettingStore.musicVolume"
              :min="0"
              :max="100"
              show-input
              class="flex-1"
              :class="isMobile ? 'order-2' : ''"
              :size="isMobile ? 'large' : 'default'"
            />
            <el-switch v-model="gameSettingStore.musicMute" active-text="静音" :size="isMobile ? 'large' : 'default'" />
          </div>
        </el-form-item>

        <el-form-item label="音效音量">
          <div
            class="flex items-center gap-4 w-full md:flex-row"
            :class="isMobile ? 'flex-col items-stretch gap-3' : ''"
          >
            <el-slider
              v-model="gameSettingStore.soundVolume"
              :min="0"
              :max="100"
              show-input
              class="flex-1"
              :class="isMobile ? 'order-2' : ''"
              :size="isMobile ? 'large' : 'default'"
            />
            <el-switch v-model="gameSettingStore.soundMute" active-text="静音" :size="isMobile ? 'large' : 'default'" />
          </div>
        </el-form-item>

        <el-form-item label="全局静音">
          <el-switch v-model="gameSettingStore.mute" :size="isMobile ? 'large' : 'default'" />
        </el-form-item>
      </el-form>

      <template #footer>
        <div class="flex gap-3 justify-end md:flex-row md:gap-4" :class="isMobile ? 'flex-col-reverse gap-2' : ''">
          <el-button
            @click="showEditDialog = false"
            :size="isMobile ? 'large' : 'default'"
            :class="isMobile ? 'w-full m-0' : ''"
          >
            取消
          </el-button>
          <el-button
            type="primary"
            @click="handleSave"
            :size="isMobile ? 'large' : 'default'"
            :class="isMobile ? 'w-full m-0' : ''"
          >
            保存更改
          </el-button>
        </div>
      </template>
    </el-dialog>

    <main class="flex-1 overflow-auto">
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" class="w-full" />
        </transition>
      </router-view>
    </main>

    <!-- 全局状态提示 - 移除 el-affix，使用固定定位 -->
    <div class="fixed right-4 bottom-4 z-50 md:right-5 md:bottom-5 pointer-events-none">
      <el-tag
        :type="connectionState === 'connected' ? 'success' : 'danger'"
        effect="dark"
        round
        class="pointer-events-auto"
      >
        <el-icon :size="14">
          <Connection />
        </el-icon>
        {{ connectionState === 'connected' ? '已连接' : '未连接' }}
      </el-tag>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useBreakpoints, breakpointsTailwind } from '@vueuse/core'
import { useBattleClientStore } from './stores/battleClient'
import { useGameDataStore } from './stores/gameData'
import { usePlayerStore } from './stores/player'
import { usePetStorageStore } from './stores/petStorage'
import { useResourceStore } from './stores/resource'
import { useServerStateStore } from './stores/serverState'
import { useGameSettingStore } from './stores/gameSetting'
import {
  Menu,
  Close,
  House,
  Edit,
  MagicStick,
  Box,
  Document,
  User,
  Connection,
  Setting,
  ArrowDown,
  FolderOpened,
} from '@element-plus/icons-vue'

const router = useRouter()
const dataStore = useGameDataStore()
const resourceStore = useResourceStore()
const playerStore = usePlayerStore()
const petStorage = usePetStorageStore()
const serverState = useServerStateStore()
const gameSettingStore = useGameSettingStore()
const battleClientStore = useBattleClientStore()

// 使用 VueUse 的响应式断点检测
const breakpoints = useBreakpoints(breakpointsTailwind)
const isMobile = breakpoints.smaller('md') // md 断点是 768px

// 移动端菜单状态
const showMobileMenu = ref(false)

// 监听移动端状态变化，当切换到桌面端时自动关闭移动端菜单
watch(isMobile, newIsMobile => {
  if (!newIsMobile) {
    showMobileMenu.value = false
  }
})

// 连接状态
const connectionState = computed(() => {
  return battleClientStore.currentState.status
})

// 初始化连接
onMounted(async () => {
  try {
    // 首先初始化基础数据
    dataStore.initialize()
    resourceStore.initialize()
    petStorage.loadFromLocal()

    // 初始化玩家状态（这会确保Pinia store准备就绪）
    await playerStore.initializePlayer()

    // 确保玩家ID存在
    if (!playerStore.id) {
      console.error('Player ID is missing after initialization')
      ElMessage.error('玩家ID初始化失败，请刷新页面重试')
      return
    }

    // 等待一个tick确保所有store都已初始化
    await nextTick()

    // 现在初始化battleClient（此时Pinia已经完全准备好）
    battleClientStore.initialize()

    // 等待玩家认证完成后再连接战斗客户端
    // 对于注册用户，需要等待自动登录完成
    if (playerStore.is_registered) {
      // 等待认证完成
      let authCheckCount = 0
      const maxAuthChecks = 50 // 最多等待5秒

      const waitForAuth = () => {
        if (playerStore.isAuthenticated || authCheckCount >= maxAuthChecks) {
          // 认证完成或超时，连接战斗客户端
          setTimeout(async () => {
            try {
              console.log('连接战斗客户端，认证状态:', playerStore.isAuthenticated)
              await battleClientStore.connect()
            } catch (err) {
              console.error('Battle client connection failed:', err)
              ElMessage.error('连接服务器失败')
            }
          }, 100)
        } else {
          authCheckCount++
          setTimeout(waitForAuth, 100)
        }
      }

      waitForAuth()
    } else {
      // 游客用户，直接连接
      setTimeout(async () => {
        try {
          await battleClientStore.connect()
        } catch (err) {
          console.error('Battle client connection failed:', err)
          ElMessage.error('连接服务器失败')
        }
      }, 100)
    }
  } catch (err) {
    console.error('Initialization error:', err)
    ElMessage.error('初始化失败，请刷新页面重试')
  }
})

const backgroundOptions = computed(() => {
  return resourceStore.loaded ? resourceStore.background.allIds.filter(id => id !== 'random') : []
})

const musicOptions = computed(() => {
  return resourceStore.loaded ? resourceStore.music.allIds.filter(id => id !== 'random') : []
})

const showEditDialog = ref(false)

// 处理保存
const handleSave = () => {
  // gameSettingStore.saveToLocal() // 如果有保存到本地的逻辑
  showEditDialog.value = false
  ElMessage.success('游戏设置已保存')
}

// 导航到账户页面
const navigateToAccount = () => {
  showEditDialog.value = false
  router.push('/account')
}

// 处理战报下拉菜单命令
const handleBattleReportCommand = (command: string) => {
  switch (command) {
    case 'online-reports':
      router.push('/battle-reports')
      break
    case 'local-reports':
      router.push('/local-battle-reports')
      break
  }
}
</script>

<style>
@import 'tailwindcss';
html,
body,
#app {
  margin: 0px;
  padding: 0px;
  width: 100%;
  box-sizing: border-box;
  /* 完全禁用双指缩放和双击缩放，只允许垂直滚动 */
  touch-action: pan-y;
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  -khtml-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
  user-select: none;
  /* 禁用iOS Safari的双击缩放和自动缩放 */
  -webkit-text-size-adjust: 100%;
  -ms-text-size-adjust: 100%;
  /* 额外的缩放控制 */
  zoom: 1;
}

* {
  box-sizing: border-box;
  /* 确保所有元素都禁用缩放 */
  touch-action: inherit;
}

/* 全局禁用双指缩放和双击缩放 */
*,
*::before,
*::after {
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
}

/* 对于交互元素，禁用双击缩放但保留点击功能 */
button,
input,
select,
textarea,
a,
.el-button,
.el-input,
.el-select,
.touch-manipulation {
  touch-action: manipulation;
}

/* 对于可滚动区域，只允许垂直滚动 */
.overflow-auto,
.el-scrollbar,
.el-dialog__body,
.el-drawer__body {
  touch-action: pan-y;
}

/* 确保页面内容可以正常滚动 */
html {
  height: 100%;
  overflow: auto;
}

body {
  height: 100%;
  overflow: auto;
}

#app {
  height: 100%;
  overflow: visible;
}

/* 修复可能的滚动问题 */
.overflow-auto {
  -webkit-overflow-scrolling: touch;
}

/* 确保主容器不会阻止滚动 */
main {
  overflow: auto !important;
  position: relative !important;
}

/* 确保顶栏始终置顶 */
header {
  position: sticky !important;
  top: 0 !important;
  z-index: 40 !important;
}

/* 确保页面布局正确 */
.h-screen {
  height: 100vh !important;
  height: 100dvh !important; /* 动态视口高度，更适合移动端 */
}

/* 动画效果 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* Element Plus 深度选择器样式 - 移动端优化 */
@media (max-width: 767px) {
  /* 确保移动端菜单在小屏幕上正常显示 */
  .el-drawer {
    max-width: 85vw !important;
  }

  /* 移动端对话框优化 */
  .mobile-dialog .el-dialog {
    margin: 0 !important;
    max-height: 100vh !important;
    border-radius: 0 !important;
  }

  .mobile-dialog .el-dialog__body {
    padding: 16px !important;
    max-height: calc(100vh - 120px) !important;
    overflow-y: auto !important;
  }

  /* 移动端表单优化 */
  .mobile-form .el-form-item {
    margin-bottom: 20px !important;
  }

  .mobile-form .el-form-item__label {
    line-height: 1.4 !important;
    padding-bottom: 8px !important;
  }
}

/* 触摸设备优化 */
@media (hover: none) and (pointer: coarse) {
  .mobile-menu-btn,
  .mobile-menu-close,
  .mobile-menu-item {
    min-height: 44px; /* iOS 推荐的最小触摸目标 */
  }

  .mobile-user-btn {
    min-height: 36px;
    min-width: 36px;
  }
}
</style>
