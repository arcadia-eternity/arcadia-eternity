<template>
  <div class="account-page">
    <div class="container mx-auto px-4 py-8">
      <!-- 页面标题 -->
      <div class="mb-8">
        <h1 class="text-3xl font-bold text-gray-800 mb-2">档案与账号</h1>
        <p class="text-gray-600">管理本地档案，查看当前服务器身份</p>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <!-- 本地档案 -->
        <div class="space-y-6">
          <el-card>
            <template #header>
              <div class="flex items-center">
                <el-icon class="mr-2"><User /></el-icon>
                <span>本地档案</span>
              </div>
            </template>

            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">档案 UID</label>
                <div class="flex items-center space-x-2">
                  <code class="bg-gray-100 px-3 py-2 rounded text-sm font-mono flex-1 min-w-0 break-all">
                    {{ playerStore.id }}
                  </code>
                  <el-button size="small" aria-label="复制档案 UID" @click="copyPlayerId">
                    <el-icon><DocumentCopy /></el-icon>
                  </el-button>
                </div>
                <p class="text-xs text-gray-500 mt-1">UID 是公开的档案编号，不能用于登录或接管对战席位。</p>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">玩家名称</label>
                <div class="flex items-center space-x-2">
                  <el-input
                    v-if="editingName"
                    ref="nameInput"
                    v-model="newName"
                    size="small"
                    maxlength="30"
                    show-word-limit
                    @keyup.enter="saveName"
                    @keyup.esc="cancelEdit"
                    @blur="saveName"
                  />
                  <span v-else class="flex-1 py-2">{{ playerStore.name }}</span>

                  <el-button size="small" @click="editingName ? saveName() : startEditName()">
                    <el-icon>
                      <Check v-if="editingName" />
                      <Edit v-else />
                    </el-icon>
                  </el-button>
                </div>
              </div>

              <el-alert title="资料保存在当前设备" type="info" :closable="false" show-icon>
                <p>本地档案、队伍和设置可以离线使用。登录或退出服务器账号不会改变档案 UID。</p>
                <p class="mt-2">
                  请保留完整的本地资料备份。清空本地数据且没有备份时，仅凭 UID
                  无法找回资料；账号只能恢复服务器实际保存过的内容。
                </p>
              </el-alert>
            </div>
          </el-card>

          <!-- 快速操作 -->
          <el-card>
            <template #header>
              <div class="flex items-center">
                <el-icon class="mr-2"><Setting /></el-icon>
                <span>快速操作</span>
              </div>
            </template>

            <div class="space-y-3">
              <router-link to="/storage">
                <el-button type="primary" class="w-full">
                  <el-icon class="mr-2"><FolderOpened /></el-icon>
                  管理精灵和队伍
                </el-button>
              </router-link>

              <router-link to="/team-builder">
                <el-button type="success" class="w-full">
                  <el-icon class="mr-2"><Plus /></el-icon>
                  创建新队伍
                </el-button>
              </router-link>

              <el-divider />

              <el-button
                type="info"
                @click="startPrecache"
                :loading="precaching"
                class="w-full"
                :disabled="!gameDataStore.loaded"
              >
                <el-icon class="mr-2"><Download /></el-icon>
                预缓存精灵资源
              </el-button>

              <p class="text-xs text-gray-500">
                {{
                  isDesktop
                    ? '预先下载所有精灵的动画资源到本地，提升对战体验'
                    : '预先下载所有精灵的动画资源，提升对战体验'
                }}
                <span v-if="cacheStats.total > 0"> (已缓存: {{ cacheStats.cached }}/{{ cacheStats.total }}) </span>
              </p>

              <el-button
                v-if="cacheStats.cached > 0"
                type="warning"
                size="small"
                @click="resetCacheStatus"
                class="w-full"
                plain
              >
                <el-icon class="mr-2"><Refresh /></el-icon>
                {{ isDesktop ? '清理缓存' : '重置状态' }}
              </el-button>
            </div>
          </el-card>
        </div>

        <div class="space-y-6">
          <el-card>
            <template #header>
              <div class="flex items-center">
                <el-icon class="mr-2"><User /></el-icon>
                <span>当前服务器身份</span>
              </div>
            </template>

            <div class="space-y-4">
              <el-tag :type="authStore.isAccount ? 'success' : 'info'">
                {{ sessionStatus }}
              </el-tag>
              <p v-if="authStore.isAccount" class="text-sm text-gray-600">
                当前使用服务器账号。账号身份由服务器验证，本地档案和队伍仍由本设备保存。
              </p>
              <p v-else-if="authStore.isAuthenticated" class="text-sm text-gray-600">
                当前使用游客会话，无需注册。服务器通过会话凭证授权房间席位，相同 UID 不会获得相同权限。
              </p>
              <p v-else class="text-sm text-gray-600">
                尚未建立有效服务器会话。您仍可使用本地档案；加入联机房间时会申请游客会话。
              </p>
              <p v-if="authStore.session" class="text-xs text-gray-500 break-all">
                服务器：{{ authStore.session.serverId }}
              </p>
              <p class="text-sm text-gray-600">
                服务器账号是可选功能，登录方式由所连接的服务器提供。账号数据不会自动跨服务器共享。
              </p>
              <el-alert title="房间只在服务器本次运行期间有效" type="info" :closable="false" show-icon>
                网络短断后可凭有效会话重连。服务器重启后，原会话、房间和席位全部失效，需要重新加入。
              </el-alert>
              <el-button v-if="authStore.isAccount" :loading="loggingOut" @click="logout"> 退出服务器账号 </el-button>
            </div>
          </el-card>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  User,
  DocumentCopy,
  Edit,
  Check,
  Setting,
  Refresh,
  FolderOpened,
  Plus,
  Download,
} from '@element-plus/icons-vue'
import { usePlayerStore } from '@/stores/player'
import { useGameDataStore } from '@/stores/gameData'
import { useAuthStore } from '@/stores/auth'
import { petResourceCache } from '@/services/petResourceCache'
import { isDesktop } from '@/utils/env'

const playerStore = usePlayerStore()
const gameDataStore = useGameDataStore()
const authStore = useAuthStore()
const loggingOut = ref(false)
const sessionStatus = computed(() => {
  if (!authStore.isAuthenticated) return '未连接服务器身份'
  return authStore.isAccount ? '服务器账号' : '游客会话'
})

const logout = async () => {
  loggingOut.value = true
  try {
    await authStore.logout()
    ElMessage.success('已退出服务器账号，本地档案已保留')
  } catch {
    ElMessage.error('退出失败，请重试')
  } finally {
    loggingOut.value = false
  }
}

// 编辑名称相关
const editingName = ref(false)
const newName = ref('')
const nameInput = ref()

// 预缓存相关
const precaching = ref(false)
const cacheStats = computed(() => petResourceCache.getStats())

// 开始编辑名称
const startEditName = async () => {
  newName.value = playerStore.name
  editingName.value = true

  // 等待DOM更新后聚焦并选择文本
  await nextTick()
  if (nameInput.value) {
    nameInput.value.focus()
    nameInput.value.select()
  }
}

// 保存名称
const saveName = () => {
  const trimmedName = newName.value.trim()

  // 如果名称为空，恢复原名称
  if (!trimmedName) {
    newName.value = playerStore.name
    editingName.value = false
    return
  }

  // 如果名称有变化，保存新名称
  if (trimmedName !== playerStore.name) {
    playerStore.setName(trimmedName)
    ElMessage.success('玩家名称已更新')
  }

  editingName.value = false
}

// 取消编辑名称
const cancelEdit = () => {
  newName.value = playerStore.name
  editingName.value = false
}

// 复制公开的档案编号
const copyPlayerId = async () => {
  try {
    await navigator.clipboard.writeText(playerStore.id)
    ElMessage.success('档案 UID 已复制到剪贴板')
  } catch {
    // 降级方案
    const textArea = document.createElement('textarea')
    textArea.value = playerStore.id
    document.body.appendChild(textArea)
    textArea.select()
    document.execCommand('copy')
    document.body.removeChild(textArea)
    ElMessage.success('档案 UID 已复制到剪贴板')
  }
}

// 开始预缓存
const startPrecache = async () => {
  try {
    precaching.value = true

    // 获取所有宠物编号
    const allSpecies = gameDataStore.speciesList
    const petNums = allSpecies.map(species => species.num).filter(num => num && num > 0)

    if (petNums.length === 0) {
      ElMessage.warning('没有找到可缓存的精灵资源')
      return
    }

    ElMessage.info(`开始预缓存 ${petNums.length} 个精灵资源...`)

    // 开始预缓存
    await petResourceCache.preloadAllPets(petNums, () => {
      // 可以在这里更新进度，但目前我们只在完成时显示消息
    })

    ElMessage.success(`成功预缓存 ${petNums.length} 个精灵资源！`)
  } catch (error: unknown) {
    console.error('预缓存失败:', error)
    ElMessage.error(`预缓存失败: ${(error as Error).message}`)
  } finally {
    precaching.value = false
  }
}

// 重置缓存状态
const resetCacheStatus = async () => {
  try {
    const confirmMessage = isDesktop
      ? '确定要清理本地缓存吗？这将删除所有已下载的精灵资源文件，需要重新下载。'
      : '确定要重置缓存状态记录吗？这只会清除我们的缓存状态记录，不会影响浏览器实际缓存的资源。'

    const confirmTitle = isDesktop ? '确认清理缓存' : '确认重置状态'

    await ElMessageBox.confirm(confirmMessage, confirmTitle, {
      confirmButtonText: '确认',
      cancelButtonText: '取消',
      type: 'warning',
    })

    await petResourceCache.resetCache()

    const successMessage = isDesktop ? '本地缓存已清理' : '缓存状态已重置'
    ElMessage.success(successMessage)
  } catch {
    // 用户取消操作
  }
}

// 组件挂载时初始化缓存统计
onMounted(() => {
  petResourceCache.initStats()
})
</script>

<style scoped>
.account-page {
  min-height: 100vh;
  background-color: #f5f5f5;
}

.container {
  max-width: 1200px;
}

code {
  font-family: 'Courier New', monospace;
  font-size: 0.9em;
}

:deep(.el-card) {
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

:deep(.el-card__header) {
  background-color: #fafafa;
  border-bottom: 1px solid #ebeef5;
}
</style>
