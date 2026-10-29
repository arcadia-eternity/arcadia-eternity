<template>
  <div
    class="lobby-container w-full mx-auto text-center min-h-screen box-border flex flex-col px-4 py-6 md:px-5 md:py-8 max-w-4xl"
  >
    <h1 class="text-2xl md:text-3xl font-bold mb-6 md:mb-8 text-gray-800">对战大厅</h1>

    <section class="bg-white rounded-lg shadow-sm border border-gray-200 p-4 text-left" aria-label="对战服务器">
      <h2 class="text-lg font-medium text-gray-800">对战服务器</h2>
      <p class="text-sm text-gray-600 mt-1">
        当前地址：<span data-testid="current-server-address">{{ battleClientStore.serverUrl }}</span>
      </p>
      <div v-if="canSelectBackend()" class="flex flex-col sm:flex-row gap-2 mt-3">
        <el-input
          v-model="serverAddress"
          :disabled="switchingServer"
          placeholder="例如 http://localhost:8102"
          aria-label="服务器地址"
          data-testid="server-address-input"
          @keyup.enter="connectServer"
        />
        <el-button
          type="primary"
          :disabled="switchingServer || !serverAddress.trim()"
          :loading="switchingServer"
          data-testid="connect-server-button"
          @click="connectServer"
          >打开联机窗口</el-button
        >
        <el-button
          v-if="canStartLocalServer"
          :disabled="switchingServer"
          data-testid="start-local-server-button"
          @click="startLocalServer"
          >由本机托管联机对战</el-button
        >
      </div>
      <p v-if="canSelectBackend()" class="text-xs text-gray-500 mt-2">
        远程服务器在独立联机窗口中打开。本机托管会离开当前房间；正在进行的对局也会终止。
      </p>
      <p v-if="serverSwitchError" role="alert" class="text-sm text-red-700 mt-2">{{ serverSwitchError }}</p>
    </section>

    <!-- 导航菜单 -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 md:gap-4 my-6 md:my-8 mx-auto max-w-6xl">
      <router-link
        to="/team-builder"
        class="flex flex-col items-center gap-2 p-4 md:p-4 bg-white border-2 border-gray-300 rounded-lg no-underline text-gray-700 transition-all duration-300 font-medium hover:border-blue-500 hover:bg-slate-50 hover:text-blue-500 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(59,130,246,0.15)] router-link-active:border-blue-500 router-link-active:bg-blue-50 router-link-active:text-blue-500 min-h-[80px] md:min-h-[auto] touch-manipulation"
      >
        <el-icon :size="20"><User /></el-icon>
        <span class="text-sm md:text-base">队伍编辑</span>
      </router-link>
      <router-link
        to="/account"
        class="flex flex-col items-center gap-2 p-4 md:p-4 bg-white border-2 border-gray-300 rounded-lg no-underline text-gray-700 transition-all duration-300 font-medium hover:border-blue-500 hover:bg-slate-50 hover:text-blue-500 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(59,130,246,0.15)] router-link-active:border-blue-500 router-link-active:bg-blue-50 router-link-active:text-blue-500 min-h-[80px] md:min-h-[auto] touch-manipulation"
      >
        <el-icon :size="20"><Setting /></el-icon>
        <span class="text-sm md:text-base">档案与账号</span>
      </router-link>
      <router-link
        to="/dex"
        class="flex flex-col items-center gap-2 p-4 md:p-4 bg-white border-2 border-gray-300 rounded-lg no-underline text-gray-700 transition-all duration-300 font-medium hover:border-blue-500 hover:bg-slate-50 hover:text-blue-500 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(59,130,246,0.15)] router-link-active:border-blue-500 router-link-active:bg-blue-50 router-link-active:text-blue-500 min-h-[80px] md:min-h-[auto] touch-manipulation"
      >
        <el-icon :size="20"><Collection /></el-icon>
        <span class="text-sm md:text-base">图鉴</span>
      </router-link>
      <router-link
        to="/local-battle-reports"
        class="flex flex-col items-center gap-2 p-4 md:p-4 bg-white border-2 border-gray-300 rounded-lg no-underline text-gray-700 transition-all duration-300 font-medium hover:border-blue-500 hover:bg-slate-50 hover:text-blue-500 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(59,130,246,0.15)] router-link-active:border-blue-500 router-link-active:bg-blue-50 router-link-active:text-blue-500 min-h-[80px] md:min-h-[auto] touch-manipulation"
      >
        <el-icon :size="20"><FolderOpened /></el-icon>
        <span class="text-sm md:text-base">本地战报</span>
      </router-link>
      <router-link
        v-if="!isDesktop"
        to="/download"
        class="flex flex-col items-center gap-2 p-4 md:p-4 bg-white border-2 border-gray-300 rounded-lg no-underline text-gray-700 transition-all duration-300 font-medium hover:border-blue-500 hover:bg-slate-50 hover:text-blue-500 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(59,130,246,0.15)] router-link-active:border-blue-500 router-link-active:bg-blue-50 router-link-active:text-blue-500 min-h-[80px] md:min-h-[auto] touch-manipulation"
      >
        <el-icon :size="20"><Download /></el-icon>
        <span class="text-sm md:text-base">下载客户端</span>
      </router-link>
      <router-link
        to="/local-battle"
        class="flex flex-col items-center gap-2 p-4 md:p-4 bg-white border-2 border-gray-300 rounded-lg no-underline text-gray-700 transition-all duration-300 font-medium hover:border-blue-500 hover:bg-slate-50 hover:text-blue-500 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(59,130,246,0.15)] router-link-active:border-blue-500 router-link-active:bg-blue-50 router-link-active:text-blue-500 min-h-[80px] md:min-h-[auto] touch-manipulation"
      >
        <el-icon :size="20"><Monitor /></el-icon>
        <span class="text-sm md:text-base">人机对战</span>
      </router-link>
      <a
        href="https://github.com/arcadia-eternity/arcadia-eternity"
        target="_blank"
        rel="noopener noreferrer"
        class="flex flex-col items-center gap-2 p-4 md:p-4 bg-white border-2 border-gray-300 rounded-lg no-underline text-gray-700 transition-all duration-300 font-medium hover:border-blue-500 hover:bg-slate-50 hover:text-blue-500 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(59,130,246,0.15)] min-h-[80px] md:min-h-[auto] touch-manipulation"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path
            d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
          />
        </svg>
        <span class="text-sm md:text-base">GitHub</span>
      </a>
    </div>

    <MatchmakingPanel :auto-open="startMatching" />

    <!-- 好友房间 -->
    <div class="mb-6 md:mb-8 space-y-6">
      <!-- 私人房间区域 -->
      <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <h3 class="text-lg font-medium text-gray-800 mb-4 flex items-center gap-2">
          <el-icon><User /></el-icon>
          私人房间
        </h3>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <!-- 如果已在房间，显示进入房间按钮 -->
          <div v-if="privateRoomStore.currentRoom" class="md:col-span-3">
            <h4 class="text-sm font-medium text-gray-700 mb-3">你已在房间中</h4>
            <el-button type="primary" @click="goToCurrentRoom" class="w-full">
              回到房间 ({{ privateRoomStore.currentRoom.config.roomCode }})
            </el-button>
          </div>

          <!-- 否则，显示创建和加入选项 -->
          <template v-else>
            <!-- 创建房间 -->
            <div class="space-y-3">
              <h4 class="text-sm font-medium text-gray-700">创建房间</h4>
              <el-button
                type="success"
                :disabled="switchingServer || battleClientStore.currentState.status !== 'connected'"
                @click="openCreateRoomDialog"
                class="w-full"
                data-testid="create-private-room-button"
              >
                创建私人房间
              </el-button>
            </div>

            <!-- 加入房间 -->
            <div class="space-y-3 md:col-span-2">
              <h4 class="text-sm font-medium text-gray-700">加入房间</h4>
              <div class="flex gap-2">
                <el-input
                  v-model="joinRoomCode"
                  placeholder="输入房间码"
                  maxlength="6"
                  class="flex-1"
                  @keyup.enter="joinRoom"
                  data-testid="join-room-code-input"
                />
                <el-button
                  type="primary"
                  :disabled="switchingServer || !joinRoomCode || battleClientStore.currentState.status !== 'connected'"
                  @click="joinRoom"
                  data-testid="join-private-room-button"
                >
                  加入
                </el-button>
                <el-button
                  type="info"
                  :disabled="switchingServer || !joinRoomCode || battleClientStore.currentState.status !== 'connected'"
                  @click="joinAsSpectator"
                >
                  观战
                </el-button>
              </div>
              <el-input v-model="joinRoomPassword" placeholder="房间密码（公开房间留空）" show-password />
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- 提示信息 -->
    <div class="mt-6 md:mt-8 text-left">
      <el-alert title="使用提示" type="info" :closable="false" class="mb-4">
        <ul class="text-left text-sm md:text-base space-y-1">
          <li>不要忘了 先在队伍编辑里面编辑队伍</li>
          <li>目前正在活跃更新中 可能会有一些bug 尽量谅解</li>
          <li>短暂断线后可恢复仍然存在的房间；服务器重启后，需要重新创建房间。</li>
          <li>人机对战可以在没有连接服务器的情况下进行</li>
          <li>群号：805146068</li>
        </ul>
      </el-alert>
    </div>

    <!-- 创建房间对话框 -->
    <el-dialog v-model="showCreateRoomDialog" title="创建私人房间" width="min(500px, 92vw)">
      <el-form :model="roomConfig" label-width="100px">
        <el-form-item label="房间密码">
          <el-input v-model="roomConfig.password" placeholder="留空为公开房间" show-password />
        </el-form-item>
        <RoomBattleOptions v-model="battleOptions" />
        <el-form-item v-if="battleOptions.battleMode === 'server'" label="对战内容">
          <div class="w-full">
            <el-select
              v-model="selectedEnvironmentId"
              :loading="environmentsLoading"
              class="w-full"
              aria-label="选择对战内容"
              data-testid="room-environment-select"
            >
              <el-option label="官方内容" value="" />
              <el-option
                v-for="environment in customEnvironments"
                :key="environment.id"
                :label="environmentLabel(environment)"
                :value="environment.id"
              />
            </el-select>
            <p v-if="environmentsError" class="text-xs text-amber-700 mt-2" role="status">
              内容列表暂不可用，可以使用官方内容。
              <el-button link type="primary" @click="loadEnvironments">重试</el-button>
            </p>
            <p v-else-if="selectedEnvironmentId" class="text-xs text-gray-500 mt-2">
              房间创建后使用选定的内容；对战由服务器运行。
            </p>
          </div>
        </el-form-item>
        <el-form-item v-if="battleOptions.battleMode === 'p2p'" label="P2P 传输">
          <el-radio-group v-model="roomConfig.p2pTransport">
            <el-radio value="auto">自动</el-radio>
            <el-radio value="webrtc">WebRTC</el-radio>
            <el-radio value="relay">Relay</el-radio>
          </el-radio-group>
          <div class="text-xs text-gray-500 mt-2">自动模式优先建立直连；连接受限时使用服务器中继。</div>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showCreateRoomDialog = false">取消</el-button>
        <el-button
          type="primary"
          data-testid="confirm-create-private-room-button"
          :disabled="environmentsLoading || switchingServer"
          @click="createRoom"
          >创建</el-button
        >
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useBattleClientStore } from '@/stores/battleClient'
import { usePrivateRoomStore } from '@/stores/privateRoom'
import { useAuthStore } from '@/stores/auth'
import { User, Monitor, Setting, FolderOpened, Collection, Download } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { isDesktop } from '@/utils/env'
import { canSelectBackend, authorizeLocalBackend } from '@/bootstrap/deployment'
import RoomBattleOptions from '@/components/RoomBattleOptions.vue'
import MatchmakingPanel from '@/components/MatchmakingPanel.vue'
import { createDefaultRoomBattleOptions } from '@/utils/roomBattleOptions'
import type { ServerEnvironmentDescriptor } from '@arcadia-eternity/protocol'

defineProps<{ startMatching?: boolean }>()

const router = useRouter()
const battleClientStore = useBattleClientStore()
const privateRoomStore = usePrivateRoomStore()
const authStore = useAuthStore()
const showCreateRoomDialog = ref(false)
const joinRoomCode = ref('')
const joinRoomPassword = ref('')
const battleOptions = ref(createDefaultRoomBattleOptions())
const roomConfig = ref({ password: '', p2pTransport: 'auto' as 'auto' | 'webrtc' | 'relay' })
const serverAddress = ref(battleClientStore.serverUrl)
const serverSwitchError = ref('')
const serverSwitchPending = ref(false)
const switchingServer = computed(() => serverSwitchPending.value || privateRoomStore.isSwitchingServer)
const canStartLocalServer = !!window.arcadiaDesktop?.selectAndStartLocalBattle
watch(
  () => battleClientStore.serverUrl,
  address => {
    serverAddress.value = address
  },
)

async function confirmServerSwitch(): Promise<boolean> {
  const room = privateRoomStore.currentRoom
  if (!room) return true
  const message =
    room.status === 'started'
      ? '切换服务器会离开当前房间并终止正在进行的对局。确定继续吗？'
      : '切换服务器会离开当前房间。确定继续吗？'
  try {
    await ElMessageBox.confirm(message, '切换服务器', {
      confirmButtonText: '切换服务器',
      cancelButtonText: '取消',
      type: 'warning',
    })
    return true
  } catch {
    return false
  }
}

async function connectServer() {
  const address = serverAddress.value.trim()
  if (!address || switchingServer.value) return
  serverSwitchPending.value = true
  serverSwitchError.value = ''
  try {
    if (!window.arcadiaDesktop?.openRemotePlay) throw new Error('当前桌面版本不支持远程联机窗口')
    await window.arcadiaDesktop.openRemotePlay({ url: address })
  } catch (error) {
    serverSwitchError.value = error instanceof Error ? error.message : String(error)
  } finally {
    serverSwitchPending.value = false
  }
}

async function startLocalServer() {
  if (switchingServer.value || !window.arcadiaDesktop?.selectAndStartLocalBattle) return
  serverSwitchPending.value = true
  serverSwitchError.value = ''
  try {
    if (!(await confirmServerSwitch())) return
    const result = await window.arcadiaDesktop.selectAndStartLocalBattle()
    if (result.status === 'failed') throw new Error(result.message)
    if (result.status === 'running') {
      await authorizeLocalBackend()
      await privateRoomStore.switchServer(result.url)
    }
  } catch (error) {
    serverSwitchError.value = error instanceof Error ? error.message : String(error)
  } finally {
    serverSwitchPending.value = false
  }
}
const selectedEnvironmentId = ref('')
const environmentsLoading = ref(false)
const environmentsError = ref(false)
const customEnvironments = computed(() =>
  privateRoomStore.environments.filter(environment => environment.packages.length),
)

function environmentLabel(environment: ServerEnvironmentDescriptor): string {
  return environment.packages.map(pack => `${pack.name} ${pack.version}`).join('、')
}

async function loadEnvironments() {
  environmentsLoading.value = true
  environmentsError.value = false
  try {
    await privateRoomStore.refreshEnvironments()
    if (!customEnvironments.value.some(environment => environment.id === selectedEnvironmentId.value))
      selectedEnvironmentId.value = ''
  } catch {
    selectedEnvironmentId.value = ''
    environmentsError.value = true
  } finally {
    environmentsLoading.value = false
  }
}

function openCreateRoomDialog() {
  selectedEnvironmentId.value = ''
  showCreateRoomDialog.value = true
  void loadEnvironments()
}

const goToCurrentRoom = () => {
  if (privateRoomStore.currentRoom) {
    router.push(`/room/${privateRoomStore.currentRoom.config.roomCode}`)
  }
}

const createRoom = async () => {
  authStore.invalidationReason = null
  try {
    const roomCode = await privateRoomStore.createRoom(
      {
        ...battleOptions.value,
        isPrivate: !!roomConfig.value.password,
        password: roomConfig.value.password || undefined,
        p2pTransport: roomConfig.value.p2pTransport,
      },
      battleOptions.value.battleMode === 'server' ? selectedEnvironmentId.value || undefined : undefined,
    )
    showCreateRoomDialog.value = false
    roomConfig.value = { password: '', p2pTransport: 'auto' }
    ElMessage.success(`房间创建成功！房间码: ${roomCode}`)
    router.push(`/room/${roomCode}`)
  } catch (error) {
    ElMessage.error('创建房间失败: ' + (error as Error).message)
  }
}

const joinRoom = async () => {
  try {
    const code = joinRoomCode.value.trim()
    if (!code) return
    authStore.invalidationReason = null
    await privateRoomStore.joinRoom(code, joinRoomPassword.value || undefined)
    router.push(`/room/${code}`)
  } catch (error) {
    ElMessage.error('加入房间失败: ' + (error as Error).message)
  }
}

const joinAsSpectator = async () => {
  try {
    const code = joinRoomCode.value.trim()
    if (!code) return
    authStore.invalidationReason = null
    await privateRoomStore.joinAsSpectator(code, undefined, joinRoomPassword.value || undefined)
    router.push(`/room/${code}`)
  } catch (error) {
    ElMessage.error('加入观战失败: ' + (error as Error).message)
  }
}
</script>

<style scoped>
/* 确保页面内容可以正常滚动 */
.lobby-container {
  /* 当内容较少时居中显示，内容较多时允许滚动 */
  justify-content: center;
  /* 在移动端确保有足够的空间 */
  padding-bottom: env(safe-area-inset-bottom, 20px);
}

/* 当内容超出视口时，移除居中对齐 */
@media (max-height: 800px) {
  .lobby-container {
    justify-content: flex-start;
    padding-top: 2rem;
  }
}

/* 移动端触摸优化 */
@media (hover: none) and (pointer: coarse) {
  .touch-manipulation {
    touch-action: manipulation;
  }

  /* 确保触摸目标足够大 */
  .router-link,
  a {
    min-height: 44px;
  }

  button {
    min-height: 44px;
  }
}

/* 移动端特殊优化 */
@media (max-width: 767px) {
  /* 确保在小屏幕上有足够的间距 */
  .grid {
    gap: 12px;
  }

  /* 移动端按钮优化 */
  button {
    font-size: 1rem;
    padding: 16px 32px;
    border-radius: 12px;
  }

  /* 移动端卡片优化 */
  .router-link,
  a {
    border-radius: 12px;
    padding: 16px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  .router-link:active,
  a:active {
    transform: scale(0.98);
    transition: transform 0.1s ease;
  }

  /* 移动端提示框优化 */
  .el-alert {
    border-radius: 12px;
  }

  .el-alert ul {
    margin: 0;
    padding-left: 1.2rem;
  }

  .el-alert li {
    margin-bottom: 8px;
    line-height: 1.5;
  }
}

/* 平板端优化 */
@media (min-width: 768px) and (max-width: 1023px) {
  .grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

/* 确保在所有设备上都有良好的可访问性 */
.router-link:focus,
a:focus,
button:focus {
  outline: 2px solid #409eff;
  outline-offset: 2px;
}

/* 加载动画在移动端的优化 */
@media (max-width: 767px) {
  .animate-spin {
    animation-duration: 1s;
  }

  /* 移动端滚动优化 */
  .lobby-container {
    /* 确保在小屏幕上内容不会被挤压 */
    min-height: auto;
    justify-content: flex-start;
    padding-top: 1rem;
    padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 2rem);
  }
}

/* 修复可能的iOS滚动问题 */
@supports (-webkit-touch-callout: none) {
  .lobby-container {
    -webkit-overflow-scrolling: touch;
  }
}

/* 确保内容不会被固定元素遮挡 */
.lobby-container {
  position: relative;
  z-index: 1;
}
</style>
