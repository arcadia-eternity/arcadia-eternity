<template>
  <div class="account-page">
    <div class="container mx-auto px-4 py-8">
      <!-- 页面标题 -->
      <div class="mb-8">
        <h1 class="text-3xl font-bold text-gray-800 mb-2">账户管理</h1>
        <p class="text-gray-600">管理您的玩家信息和跨设备继承设置</p>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <!-- 玩家信息卡片 -->
        <div class="space-y-6">
          <el-card>
            <template #header>
              <div class="flex items-center">
                <el-icon class="mr-2"><User /></el-icon>
                <span>玩家信息</span>
              </div>
            </template>

            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">玩家ID</label>
                <div class="flex items-center space-x-2">
                  <code class="bg-gray-100 px-3 py-2 rounded text-sm font-mono flex-1">
                    {{ playerStore.id }}
                  </code>
                  <el-button size="small" @click="copyPlayerId">
                    <el-icon><DocumentCopy /></el-icon>
                  </el-button>
                </div>
                <p class="text-xs text-gray-500 mt-1">这是您的唯一标识符，请妥善保管</p>
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

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">用户状态</label>
                <div class="flex items-center space-x-2">
                  <el-tag v-if="playerStore.is_registered" type="success" size="small">
                    <el-icon class="mr-1"><CircleCheck /></el-icon>
                    注册用户
                  </el-tag>
                  <el-tag v-else type="info" size="small">
                    <el-icon class="mr-1"><User /></el-icon>
                    匿名用户
                  </el-tag>
                  <span class="text-xs text-gray-500">
                    {{ playerStore.is_registered ? '数据可跨设备同步' : '数据仅保存在本设备' }}
                  </span>
                </div>
              </div>
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
              <el-button type="warning" @click="generateNewId" :loading="generatingId" class="w-full">
                <el-icon class="mr-2"><Refresh /></el-icon>
                生成新的玩家ID
              </el-button>

              <p class="text-xs text-gray-500">⚠️ 生成新ID将清空当前所有数据，请谨慎操作</p>

              <el-divider />

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
                预先下载所有精灵的动画资源，提升对战体验
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
                重置状态
              </el-button>
            </div>
          </el-card>
        </div>

        <!-- 邮箱继承功能 -->
        <div>
          <EmailInheritance />
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
  CircleCheck,
  Download,
} from '@element-plus/icons-vue'
import { usePlayerStore } from '@/stores/player'
import { useGameDataStore } from '@/stores/gameData'
import EmailInheritance from '@/components/EmailInheritance.vue'
import { resetBattleClient, initBattleClient, battleClient } from '@/utils/battleClient'
import { petResourceCache } from '@/services/petResourceCache'

const playerStore = usePlayerStore()
const gameDataStore = useGameDataStore()

// 编辑名称相关
const editingName = ref(false)
const newName = ref('')
const generatingId = ref(false)
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

// 复制玩家ID
const copyPlayerId = async () => {
  try {
    await navigator.clipboard.writeText(playerStore.id)
    ElMessage.success('玩家ID已复制到剪贴板')
  } catch (error) {
    // 降级方案
    const textArea = document.createElement('textarea')
    textArea.value = playerStore.id
    document.body.appendChild(textArea)
    textArea.select()
    document.execCommand('copy')
    document.body.removeChild(textArea)
    ElMessage.success('玩家ID已复制到剪贴板')
  }
}

// 生成新的玩家ID
const generateNewId = async () => {
  try {
    await ElMessageBox.confirm(
      '生成新的玩家ID将重置玩家信息（ID、名称、认证状态等），但会保留您的精灵和队伍数据。此操作不可撤销。是否继续？',
      '确认生成新ID',
      {
        confirmButtonText: '确认',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )

    generatingId.value = true

    // 生成新ID并重置玩家状态
    playerStore.generateNewId()

    // 重新初始化玩家状态
    await playerStore.initializePlayer()

    // 重新初始化battleClient以使用新的玩家ID
    try {
      resetBattleClient()
      initBattleClient()
      await battleClient.connect()
      console.log('BattleClient重新连接成功，使用新的玩家ID')
    } catch (error) {
      console.warn('BattleClient重新连接失败:', error)
      // 不阻塞用户操作，只是记录警告
    }
  } catch {
    // 用户取消操作
  } finally {
    generatingId.value = false
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
    await petResourceCache.precacheAll(petNums, (_progress: { current: number; total: number; percent: number }) => {
      // 可以在这里更新进度，但目前我们只在完成时显示消息
    })

    ElMessage.success(`成功预缓存 ${petNums.length} 个精灵资源！`)
  } catch (error) {
    console.error('预缓存失败:', error)
    ElMessage.error(`预缓存失败: ${(error as Error).message}`)
  } finally {
    precaching.value = false
  }
}

// 重置缓存状态
const resetCacheStatus = async () => {
  try {
    await ElMessageBox.confirm(
      '确定要重置缓存状态记录吗？这只会清除我们的缓存状态记录，不会影响浏览器实际缓存的资源。',
      '确认重置状态',
      {
        confirmButtonText: '确认',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )

    petResourceCache.resetCacheStatus()
    ElMessage.success('缓存状态已重置')
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
