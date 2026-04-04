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
          <ConnectionStatus />
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
            人机对战
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
          <!-- 房间状态显示 -->
          <el-button v-if="privateRoomStore.currentRoom" type="warning" size="small" @click="handleRoomButtonClick">
            <el-icon><House /></el-icon>
            房间: {{ privateRoomStore.currentRoom.config.roomCode }}
          </el-button>

          <ConnectionStatus />

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
            <span>人机对战</span>
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
          <div class="space-y-3">
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

            <!-- 移动端版本信息 -->
            <div class="flex justify-center">
              <VersionInfo />
            </div>
          </div>
        </div>
      </div>
    </el-drawer>

    <!-- 移动端优化的设置对话框 -->
    <el-dialog
      v-model="showEditDialog"
      title="游戏设置"
      :width="isMobile ? '95%' : '600px'"
      :fullscreen="isMobile"
      destroy-on-close
      :class="isMobile ? 'mobile-dialog' : ''"
      class="settings-dialog"
    >
      <!-- 使用标签页组织设置内容 -->
      <div class="settings-content">
        <el-tabs v-model="activeSettingTab" :stretch="true">
          <!-- 账户管理标签页 -->
          <el-tab-pane label="账户" name="account">
            <el-form :label-width="isMobile ? '70px' : '80px'" :class="isMobile ? 'mobile-form' : ''">
              <el-form-item label="账户管理">
                <el-button
                  type="primary"
                  :size="isMobile ? 'large' : 'default'"
                  @click="navigateToAccount"
                  class="w-full"
                >
                  <el-icon class="mr-2"><User /></el-icon>
                  管理账户信息
                </el-button>
              </el-form-item>
            </el-form>
          </el-tab-pane>

          <!-- 游戏设置标签页 -->
          <el-tab-pane label="游戏" name="game">
            <el-form :label-width="isMobile ? '70px' : '80px'" :class="isMobile ? 'mobile-form' : ''">
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
                  <el-switch
                    v-model="gameSettingStore.musicMute"
                    active-text="静音"
                    :size="isMobile ? 'large' : 'default'"
                  />
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
                  <el-switch
                    v-model="gameSettingStore.soundMute"
                    active-text="静音"
                    :size="isMobile ? 'large' : 'default'"
                  />
                </div>
              </el-form-item>

              <el-form-item label="全局静音">
                <el-switch v-model="gameSettingStore.mute" :size="isMobile ? 'large' : 'default'" />
              </el-form-item>
            </el-form>
          </el-tab-pane>

          <!-- 战斗日志设置标签页 -->
          <el-tab-pane label="日志" name="battlelog">
            <el-form :label-width="isMobile ? '70px' : '80px'" :class="isMobile ? 'mobile-form' : ''">
              <el-form-item label="日志过滤">
                <div class="w-full">
                  <!-- 快捷操作按钮 -->
                  <div class="flex gap-2 mb-3">
                    <el-button @click="gameSettingStore.resetLogTypesToDefault()" size="small" type="primary" plain>
                      默认设置
                    </el-button>
                    <el-button @click="gameSettingStore.showAllLogTypes()" size="small" type="success" plain>
                      显示全部
                    </el-button>
                    <el-button @click="gameSettingStore.hideAllLogTypes()" size="small" type="danger" plain>
                      隐藏全部
                    </el-button>
                  </div>

                  <!-- 日志类型选择 - 使用折叠面板 -->
                  <el-collapse v-model="activeLogCategories" class="log-categories-collapse">
                    <el-collapse-item
                      v-for="category in logTypeCategories"
                      :key="category.name"
                      :title="category.name"
                      :name="category.name"
                    >
                      <div class="grid grid-cols-1 gap-2 p-2" :class="isMobile ? 'grid-cols-1' : 'grid-cols-2'">
                        <el-checkbox
                          v-for="logType in category.types"
                          :key="logType"
                          :model-value="gameSettingStore.visibleLogTypes.has(logType)"
                          @change="gameSettingStore.toggleLogType(logType)"
                          :size="isMobile ? 'large' : 'default'"
                        >
                          <span class="flex items-center">
                            <span class="mr-1">{{ MESSAGE_ICONS[logType] }}</span>
                            <span class="text-sm">{{ LOG_TYPE_NAMES[logType] }}</span>
                          </span>
                        </el-checkbox>
                      </div>
                    </el-collapse-item>
                  </el-collapse>
                </div>
              </el-form-item>
            </el-form>
          </el-tab-pane>
        </el-tabs>
      </div>

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

    <main class="flex-1 overflow-auto relative">
      <router-view v-slot="{ Component }">
        <transition name="fade">
          <component :is="Component" class="w-full" :key="$route.path" />
        </transition>
      </router-view>

      <!-- 桌面端版本信息 - 固定在左下角 -->
      <div v-if="!isMobile" class="fixed bottom-4 left-4 z-30 pointer-events-none">
        <div class="pointer-events-auto">
          <VersionInfo />
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, nextTick, watch, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useBreakpoints, breakpointsTailwind } from '@vueuse/core'
import { useBattleClientStore } from './stores/battleClient'
import { useGameDataStore } from './stores/gameData'
import { usePlayerStore } from './stores/player'
import { usePetStorageStore } from './stores/petStorage'
import { useResourceStore } from './stores/resource'
import { useServerStateStore } from './stores/serverState'
import { useGameSettingStore } from './stores/gameSetting'
import { usePrivateRoomStore } from './stores/privateRoom'
import { BattleMessageType } from '@arcadia-eternity/const'
import {
  Menu,
  Close,
  House,
  Edit,
  MagicStick,
  Box,
  Document,
  User,
  Setting,
  ArrowDown,
  FolderOpened,
} from '@element-plus/icons-vue'
import VersionInfo from '@/components/VersionInfo.vue'
import ConnectionStatus from '@/components/ConnectionStatus.vue'
import { autoCheckForUpdates } from '@/utils/version'
import { createAppBootstrap } from '@/app/bootstrap'
import { useBattleStore } from './stores/battle'
import { BattleClient, RemoteBattleSystem } from '@arcadia-eternity/client'
import { ClientRuleIntegration } from '@arcadia-eternity/rules'

const router = useRouter()
const dataStore = useGameDataStore()
const resourceStore = useResourceStore()
const playerStore = usePlayerStore()
const petStorage = usePetStorageStore()
const serverState = useServerStateStore()
const gameSettingStore = useGameSettingStore()
const battleClientStore = useBattleClientStore()
const battleStore = useBattleStore()
const privateRoomStore = usePrivateRoomStore()

// 使用 VueUse 的响应式断点检测
const breakpoints = useBreakpoints(breakpointsTailwind)
const isMobile = breakpoints.smaller('md') // md 断点是 768px

// 移动端菜单状态
const showMobileMenu = ref(false)

// 战斗重连处理器引用，用于清理
let battleReconnectHandler: ((event: any) => void) | null = null

// 设置战斗重连处理器
const setupBattleReconnectHandler = () => {
  if (battleReconnectHandler) {
    return
  }

  // 使用对象来存储重定向状态
  const redirectState = { isRedirecting: false }
  const refreshRecoveredBattleRuntime = async (fullBattleState: any) => {
    battleStore.battleState = fullBattleState
    battleStore.lastProcessedSequenceId = fullBattleState?.sequenceId ?? -1

    if (fullBattleState?.status === 'Ended' || !battleStore.playerId) {
      battleStore.availableActions = []
      battleStore.waitingForResponse = false
      return
    }

    try {
      battleStore.availableActions = await battleStore.fetchAvailableSelection()
      battleStore.waitingForResponse = false
      battleStore.errorMessage = null
    } catch (error) {
      console.warn('Failed to refresh available actions after reconnect:', error)
    }

    const battleClient = battleClientStore._instance as any
    if (battleClient && typeof battleClient.refreshTimerSnapshotsFromServer === 'function') {
      try {
        await battleClient.refreshTimerSnapshotsFromServer()
      } catch (error) {
        console.warn('Failed to refresh timer snapshots after reconnect:', error)
      }
    }
  }

  battleReconnectHandler = async (event: any) => {
    const data = event.detail
    // 使用防抖避免重复处理
    if (redirectState.isRedirecting) return
    redirectState.isRedirecting = true

    try {
      if (data.fullBattleState) {
        if (router.currentRoute.value.path === '/battle') {
          // 如果已经在战斗页面，复用现有的battleInterface或创建新的
          if (battleStore.battleInterface) {
            // 复用现有接口，只更新状态
            await refreshRecoveredBattleRuntime(data.fullBattleState)
          } else {
            // 没有现有接口，创建新的
            const battleInterface = new RemoteBattleSystem(battleClientStore._instance as BattleClient)
            await battleStore.initBattleWithState(battleInterface, playerStore.id, data.fullBattleState)
          }
        } else {
          // 不在战斗页面，检查是否有现有的battle接口
          if (battleStore.battleInterface) {
            // 复用现有接口，只更新状态
            await refreshRecoveredBattleRuntime(data.fullBattleState)
          } else {
            // 没有现有接口，创建新的
            const battleInterface = new RemoteBattleSystem(battleClientStore._instance as BattleClient)
            await battleStore.initBattleWithState(battleInterface, playerStore.id, data.fullBattleState)
          }
          await router.push('/battle')
        }
      } else {
        console.warn('🔄 Server did not provide battle state')
        ElMessage.info('战斗状态异常，无法跳转到战斗页面')
      }
    } catch (error) {
      console.error('🔄 Router push failed:', error)
      ElMessage.error('跳转到战斗页面失败')
    } finally {
      setTimeout(() => {
        redirectState.isRedirecting = false
      }, 1000)
    }
  }

  window.addEventListener('battleReconnect', battleReconnectHandler)
}

// 监听移动端状态变化，当切换到桌面端时自动关闭移动端菜单
watch(isMobile, newIsMobile => {
  if (!newIsMobile) {
    showMobileMenu.value = false
  }
})

// 房间按钮点击处理
const handleRoomButtonClick = () => {
  if (privateRoomStore.currentRoom) {
    const roomCode = privateRoomStore.currentRoom.config.roomCode
    router.push(`/room/${roomCode}`)
  }
}

// 初始化连接
onMounted(async () => {
  try {
    const bootstrap = createAppBootstrap()
    let initResourcePromise: Promise<void> | null = null

    bootstrap.register({
      name: 'pet-storage',
      phase: 'pre-init',
      run: () => {
        petStorage.loadFromLocal()
      },
    })
    bootstrap.register({
      name: 'client-rules',
      phase: 'pre-init',
      critical: false,
      run: () =>
        ClientRuleIntegration.initializeClient().catch(error => {
          console.error('客户端规则系统初始化失败:', error)
        }),
    })
    bootstrap.register({
      name: 'game-data',
      phase: 'data-ready',
      order: 1,
      run: async () => {
        initResourcePromise = resourceStore.initialize()
        await dataStore.initialize()
      },
    })
    bootstrap.register({
      name: 'species-provider',
      phase: 'data-ready',
      order: 2,
      critical: false,
      run: () =>
        ClientRuleIntegration.initializeSpeciesDataProvider(dataStore).catch(error => {
          console.error('❌ 种族数据提供者初始化失败:', error)
        }),
    })
    bootstrap.register({
      name: 'player-identity',
      phase: 'identity-ready',
      run: async () => {
        await playerStore.initializePlayer()
        if (!playerStore.id) {
          throw new Error('PLAYER_ID_INITIALIZATION_FAILED')
        }
      },
    })
    bootstrap.register({
      name: 'battle-client-init',
      phase: 'network-ready',
      order: 1,
      run: async () => {
        await nextTick()
        battleClientStore.initialize()
        setupBattleReconnectHandler()
      },
    })
    bootstrap.register({
      name: 'battle-client-connect',
      phase: 'network-ready',
      order: 2,
      run: async () => {
        await Promise.all([initResourcePromise, battleClientStore.connect()])
      },
    })
    bootstrap.register({
      name: 'resume-private-room',
      phase: 'network-ready',
      order: 3,
      run: async () => {
        const currentRoom = await privateRoomStore.checkCurrentRoom()
        if (currentRoom) {
          await privateRoomStore.resumeActiveBattle()
        }
      },
    })
    bootstrap.register({
      name: 'update-check',
      phase: 'post-init',
      critical: false,
      run: () => {
        setTimeout(() => {
          autoCheckForUpdates()
        }, 3000)
      },
    })

    await bootstrap.runAll()
  } catch (err) {
    console.error('Initialization error:', err)
    ElMessage.error('初始化失败，请刷新页面重试')
  }
})

// 清理事件监听器
onUnmounted(() => {
  if (battleReconnectHandler) {
    window.removeEventListener('battleReconnect', battleReconnectHandler)
    battleReconnectHandler = null
  }
})

const backgroundOptions = computed(() => {
  return resourceStore.loaded ? resourceStore.background.allIds.filter(id => id !== 'random') : []
})

const musicOptions = computed(() => {
  return resourceStore.loaded ? resourceStore.music.allIds.filter(id => id !== 'random') : []
})

const showEditDialog = ref(false)
const activeSettingTab = ref('game') // 默认显示游戏设置标签页
const activeLogCategories = ref(['战斗流程', '技能相关']) // 默认展开前两个分类

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

// 日志类型图标映射
const MESSAGE_ICONS: Record<BattleMessageType, string> = {
  [BattleMessageType.Damage]: '💥',
  [BattleMessageType.Heal]: '💚',
  [BattleMessageType.SkillUse]: '🎯',
  [BattleMessageType.PetDefeated]: '💀',
  [BattleMessageType.MarkApply]: '🔖',
  [BattleMessageType.MarkDestroy]: '❌',
  [BattleMessageType.MarkExpire]: '⌛',
  [BattleMessageType.MarkUpdate]: '🔄',
  [BattleMessageType.PetSwitch]: '🔄',
  [BattleMessageType.RageChange]: '🔥',
  [BattleMessageType.StatChange]: '📈',
  [BattleMessageType.BattleEnd]: '🏆',
  [BattleMessageType.BattleStart]: '⚔️',
  [BattleMessageType.Info]: 'ℹ️',
  [BattleMessageType.TurnAction]: '📢',
  [BattleMessageType.TurnStart]: '🔄',
  [BattleMessageType.PetRevive]: '💚',
  [BattleMessageType.SkillMiss]: '❌',
  [BattleMessageType.ForcedSwitch]: '🔄',
  [BattleMessageType.FaintSwitch]: '🎁',
  [BattleMessageType.HpChange]: '❤️',
  [BattleMessageType.SkillUseFail]: '❌',
  [BattleMessageType.DamageFail]: '❌',
  [BattleMessageType.HealFail]: '❌',
  [BattleMessageType.EffectApply]: '✨',
  [BattleMessageType.EffectApplyFail]: '❌',
  [BattleMessageType.InvalidAction]: '🚫',
  [BattleMessageType.Error]: '❌',
  [BattleMessageType.TurnEnd]: '⏹️',
  [BattleMessageType.SkillUseEnd]: '⏹️',
  [BattleMessageType.Transform]: '',
  [BattleMessageType.TransformEnd]: '',
  [BattleMessageType.TeamSelectionStart]: '',
  [BattleMessageType.TeamSelectionComplete]: '',
}

// 日志类型中文名称映射
const LOG_TYPE_NAMES: Record<BattleMessageType, string> = {
  [BattleMessageType.BattleStart]: '战斗开始',
  [BattleMessageType.BattleEnd]: '战斗结束',
  [BattleMessageType.TurnStart]: '回合开始',
  [BattleMessageType.TurnEnd]: '回合结束',
  [BattleMessageType.SkillUse]: '技能使用',
  [BattleMessageType.SkillMiss]: '技能未命中',
  [BattleMessageType.SkillUseFail]: '技能使用失败',
  [BattleMessageType.SkillUseEnd]: '技能使用结束',
  [BattleMessageType.Damage]: '伤害',
  [BattleMessageType.DamageFail]: '伤害失败',
  [BattleMessageType.Heal]: '治疗',
  [BattleMessageType.HealFail]: '治疗失败',
  [BattleMessageType.PetSwitch]: '精灵切换',
  [BattleMessageType.PetDefeated]: '精灵倒下',
  [BattleMessageType.PetRevive]: '精灵复活',
  [BattleMessageType.ForcedSwitch]: '强制切换',
  [BattleMessageType.FaintSwitch]: '击倒奖励切换',
  [BattleMessageType.MarkApply]: '印记施加',
  [BattleMessageType.MarkDestroy]: '印记销毁',
  [BattleMessageType.MarkExpire]: '印记过期',
  [BattleMessageType.MarkUpdate]: '印记更新',
  [BattleMessageType.RageChange]: '怒气变化',
  [BattleMessageType.StatChange]: '属性变化',
  [BattleMessageType.HpChange]: 'HP变化',
  [BattleMessageType.EffectApply]: '效果触发',
  [BattleMessageType.EffectApplyFail]: '效果触发失败',
  [BattleMessageType.TurnAction]: '回合行动',
  [BattleMessageType.InvalidAction]: '无效操作',
  [BattleMessageType.Info]: '信息',
  [BattleMessageType.Error]: '错误',
  [BattleMessageType.Transform]: '变身',
  [BattleMessageType.TransformEnd]: '变身结束',
  [BattleMessageType.TeamSelectionStart]: '选择队伍',
  [BattleMessageType.TeamSelectionComplete]: '选择队伍完成',
}

// 日志类型分类
const logTypeCategories = computed(() => [
  {
    name: '战斗流程',
    types: [
      BattleMessageType.BattleStart,
      BattleMessageType.BattleEnd,
      BattleMessageType.TurnStart,
      BattleMessageType.TurnEnd,
    ],
  },
  {
    name: '技能相关',
    types: [
      BattleMessageType.SkillUse,
      BattleMessageType.SkillMiss,
      BattleMessageType.SkillUseFail,
      BattleMessageType.SkillUseEnd,
    ],
  },
  {
    name: '战斗事件',
    types: [BattleMessageType.Damage, BattleMessageType.DamageFail, BattleMessageType.Heal, BattleMessageType.HealFail],
  },
  {
    name: '精灵相关',
    types: [
      BattleMessageType.PetSwitch,
      BattleMessageType.PetDefeated,
      BattleMessageType.PetRevive,
      BattleMessageType.ForcedSwitch,
      BattleMessageType.FaintSwitch,
    ],
  },
  {
    name: '印记相关',
    types: [
      BattleMessageType.MarkApply,
      BattleMessageType.MarkDestroy,
      BattleMessageType.MarkExpire,
      BattleMessageType.MarkUpdate,
    ],
  },
  {
    name: '其他',
    types: [
      BattleMessageType.RageChange,
      BattleMessageType.StatChange,
      BattleMessageType.HpChange,
      BattleMessageType.EffectApply,
      BattleMessageType.EffectApplyFail,
      BattleMessageType.TurnAction,
      BattleMessageType.InvalidAction,
      BattleMessageType.Info,
      BattleMessageType.Error,
    ],
  },
])
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

/* 设置对话框样式 - PC端内部滚动优化 */
.settings-dialog .el-dialog {
  max-height: 85vh !important;
  margin: 7.5vh auto !important;
  display: flex !important;
  flex-direction: column !important;
  overflow: hidden !important;
}

.settings-dialog .el-dialog__header {
  flex-shrink: 0 !important;
  border-bottom: 1px solid var(--el-border-color-light) !important;
}

.settings-dialog .el-dialog__body {
  flex: 1 !important;
  overflow: hidden !important;
  padding: 20px !important;
  display: flex !important;
  flex-direction: column !important;
  min-height: 0 !important; /* 关键：允许flex子元素收缩 */
}

.settings-dialog .el-dialog__footer {
  flex-shrink: 0 !important;
  padding: 20px !important;
  border-top: 1px solid var(--el-border-color-light) !important;
}

.settings-content {
  flex: 1 !important;
  overflow: hidden !important;
  display: flex !important;
  flex-direction: column !important;
  min-height: 0 !important; /* 关键：允许flex子元素收缩 */
}

.settings-content .el-tabs {
  flex: 1 !important;
  display: flex !important;
  flex-direction: column !important;
  overflow: hidden !important;
  height: 100% !important;
}

.settings-content .el-tabs__header {
  flex-shrink: 0 !important;
  margin: 0 0 20px 0 !important;
  order: 0 !important; /* 确保标签栏在上方 */
}

.settings-content .el-tabs__content {
  flex: 1 !important;
  overflow-y: auto !important;
  overflow-x: hidden !important;
  min-height: 0 !important;
  order: 1 !important; /* 确保内容在下方 */
}

/* 确保标签页面板内容可以正常滚动 */
.settings-content .el-tab-pane {
  /* 移除固定高度，让内容自然撑开但在容器内滚动 */
  padding: 0 !important;
  box-sizing: border-box !important;
}

/* 为表单内容添加内边距 */
.settings-content .el-tab-pane .el-form {
  padding: 0 !important;
}

/* 移动端设置对话框优化 */
@media (max-width: 767px) {
  .mobile-dialog .el-dialog {
    max-height: 100vh !important;
    margin: 0 !important;
    border-radius: 0 !important;
  }

  .mobile-dialog .el-dialog__body {
    padding: 16px !important;
    max-height: calc(100vh - 120px) !important;
    overflow: hidden !important;
  }

  .settings-content .el-tabs__header {
    margin: 0 0 16px 0 !important;
  }
}

/* 自定义滚动条样式 - 仅在PC端显示 */
@media (min-width: 768px) {
  .settings-content .el-tabs__content::-webkit-scrollbar {
    width: 6px;
  }

  .settings-content .el-tabs__content::-webkit-scrollbar-track {
    background: var(--el-fill-color-lighter);
    border-radius: 3px;
  }

  .settings-content .el-tabs__content::-webkit-scrollbar-thumb {
    background: var(--el-border-color-darker);
    border-radius: 3px;
  }

  .settings-content .el-tabs__content::-webkit-scrollbar-thumb:hover {
    background: var(--el-border-color-dark);
  }
}

/* 日志分类折叠面板样式 */
.log-categories-collapse {
  border: none !important;
}

.log-categories-collapse .el-collapse-item {
  margin-bottom: 8px !important;
  border: 1px solid var(--el-border-color-light) !important;
  border-radius: 8px !important;
  overflow: hidden !important;
}

.log-categories-collapse .el-collapse-item__header {
  background-color: var(--el-fill-color-extra-light) !important;
  border: none !important;
  padding: 12px 16px !important;
  font-weight: 500 !important;
  font-size: 14px !important;
}

.log-categories-collapse .el-collapse-item__content {
  padding: 8px 16px 16px 16px !important;
  border: none !important;
  background-color: var(--el-bg-color) !important;
}

.log-categories-collapse .el-collapse-item__arrow {
  margin-right: 8px !important;
}
</style>
