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
              <p class="text-sm text-gray-600">登录方式由所连接的服务器提供。账号数据不会自动跨服务器共享。</p>
              <el-alert title="房间只在服务器本次运行期间有效" type="info" :closable="false" show-icon>
                网络短断后可凭有效会话重连。服务器重启后，原会话、房间和席位全部失效，需要重新加入。
              </el-alert>
              <el-button v-if="authStore.isAccount" :loading="loggingOut" @click="logout"> 退出服务器账号 </el-button>
            </div>
          </el-card>

          <el-card v-if="accountEnabled">
            <template #header>
              <span>{{ authStore.isAccount ? '添加登录或找回方式' : '登录或创建服务器账号' }}</span>
            </template>

            <div class="space-y-4">
              <p class="text-sm text-gray-600">
                {{
                  authStore.isAccount
                    ? '先验证新的方式，再将它绑定到当前服务器账号。不能用本地 UID 绑定账号。'
                    : '验证邮箱或 GitHub 身份后登录；首次验证会创建本服务器的账号。邮箱验证码不能找回未备份的本地 UID、队伍或存档。原游客席位不会转移。'
                }}
              </p>

              <div v-if="emailEnabled" class="space-y-2">
                <h3 class="font-medium">邮箱验证码</h3>
                <el-input
                  v-model.trim="email"
                  type="email"
                  autocomplete="email"
                  placeholder="邮箱地址"
                  :disabled="accountBusy"
                />
                <el-button :loading="accountBusy" :disabled="!profileReady || !email.trim()" @click="requestEmailCode">
                  {{ authStore.isAccount ? '发送绑定验证码' : '发送登录验证码' }}
                </el-button>
                <div v-if="challengeId" class="flex flex-wrap gap-2">
                  <el-input
                    v-model.trim="emailCode"
                    class="max-w-48"
                    inputmode="numeric"
                    autocomplete="one-time-code"
                    placeholder="验证码"
                    :disabled="accountBusy"
                    @keyup.enter="completeEmailCode"
                  />
                  <el-button
                    type="primary"
                    :loading="accountBusy"
                    :disabled="!profileReady || !emailCode.trim()"
                    @click="completeEmailCode"
                  >
                    {{ challengeIntent === 'link' ? '验证并绑定' : '验证并登录' }}
                  </el-button>
                </div>
              </div>

              <div v-if="githubEnabled" class="space-y-2">
                <h3 class="font-medium">GitHub</h3>
                <el-button :loading="accountBusy" :disabled="!profileReady" @click="startGitHub">
                  {{ authStore.isAccount ? '验证并绑定 GitHub 身份' : '使用 GitHub 登录' }}
                </el-button>
                <p class="text-xs text-gray-500">将跳转到 GitHub 授权页面，完成验证后返回此页。</p>
              </div>
            </div>
          </el-card>

          <el-card v-if="authStore.isAccount">
            <template #header><span>已绑定的登录方式</span></template>
            <div class="space-y-4">
              <p class="text-sm text-gray-600">这些身份均属于当前服务器账号。至少保留一种可用的登录或找回方式。</p>
              <div v-for="identity in authStore.identities" :key="identityKey(identity)" class="identity-row">
                <div class="min-w-0">
                  <strong>{{ identityProviderLabel(identity) }}</strong>
                  <p class="text-xs text-gray-500 break-all">{{ identity.issuer }} · {{ identity.subject }}</p>
                </div>
                <el-button
                  size="small"
                  type="danger"
                  plain
                  :disabled="authStore.identities.length <= 1 || accountBusy"
                  @click="unlinkIdentity(identity)"
                >
                  解绑
                </el-button>
              </div>
              <el-empty v-if="authStore.identities.length === 0" description="正在读取已绑定的身份" :image-size="60" />
              <p v-if="authStore.identities.length === 1" class="text-xs text-gray-500">
                这是最后一种找回方式，不能解绑。请先绑定另一种方式。
              </p>
              <el-divider />
              <el-button type="danger" plain :loading="accountBusy" @click="deactivateAccount"
                >停用服务器账号</el-button
              >
              <p class="text-xs text-gray-500">
                停用会撤销所有会话及房间权限，之后无法自行登录恢复；本地档案不会删除。
              </p>
            </div>
          </el-card>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, computed, onMounted } from 'vue'
import type { AccountIdentity, AccountIntent } from '@arcadia-eternity/protocol'
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
import { takeBootOAuthCallback, SessionRequestError } from '@/services/serverSession'
import { petResourceCache } from '@/services/petResourceCache'
import { isDesktop } from '@/utils/env'

const playerStore = usePlayerStore()
const gameDataStore = useGameDataStore()
const authStore = useAuthStore()
const loggingOut = ref(false)
const accountBusy = ref(false)
const profileReady = ref(false)
const email = ref('')
const emailCode = ref('')
const challengeId = ref('')
const challengeIntent = ref<AccountIntent | null>(null)
const accountEnabled = computed(
  () => authStore.serverInfo?.authModes.includes('account') && (authStore.serverInfo.accountProviders?.length ?? 0) > 0,
)
const emailEnabled = computed(() => accountEnabled.value && authStore.serverInfo?.accountProviders?.includes('email'))
// A packaged desktop app needs a dedicated redirect bridge; the email path remains available there.
const githubEnabled = computed(
  () => !isDesktop && accountEnabled.value && authStore.serverInfo?.accountProviders?.includes('github'),
)
const sessionStatus = computed(() => {
  if (!authStore.isAuthenticated) return '未连接服务器身份'
  return authStore.isAccount ? '服务器账号' : '游客会话'
})

const localProfile = () => ({ id: playerStore.id, name: playerStore.name })
const ensureLocalProfile = async () => {
  await playerStore.initializePlayer()
  if (!playerStore.id || !playerStore.name) throw new Error('本地档案尚未准备好，请重试')
  profileReady.value = true
  return localProfile()
}
const identityKey = (identity: AccountIdentity) =>
  `${identity.providerId}\u0000${identity.issuer}\u0000${identity.subject}`
const identityProviderLabel = (identity: AccountIdentity) =>
  identity.providerId === 'email' ? '邮箱' : identity.providerId === 'github' ? 'GitHub' : identity.providerId

const accountError = (error: unknown): string => {
  if (error instanceof SessionRequestError) {
    if (error.status === 409) {
      if (error.code?.includes('LAST')) return '必须保留至少一种已验证的登录或找回方式。'
      return '该身份已绑定到其他账号，不能合并或接管。'
    }
    if (error.status === 429) return '操作过于频繁，请稍后重试。'
    if (error.status === 401 || error.status === 403) return '验证或会话已失效，请重新验证。'
    if (error.status === 410) return '验证码或登录请求已过期，请重新发起。'
    if (error.status >= 500) return '服务器暂时无法处理账号操作，请稍后重试。'
  }
  return error instanceof Error ? error.message : '账号操作失败，请重试。'
}

const requestEmailCode = async () => {
  const intent: AccountIntent = authStore.isAccount ? 'link' : 'login'
  accountBusy.value = true
  try {
    const challenge = await authStore.requestEmailCode(email.value.trim(), intent)
    challengeId.value = challenge.challengeId
    challengeIntent.value = intent
    emailCode.value = ''
    ElMessage.success('验证码已发送，请检查邮箱')
  } catch (error) {
    ElMessage.error(accountError(error))
  } finally {
    accountBusy.value = false
  }
}

const completeEmailCode = async () => {
  if (!challengeId.value || !challengeIntent.value) return
  accountBusy.value = true
  try {
    const profile = await ensureLocalProfile()
    await authStore.completeEmailCode(challengeId.value, emailCode.value.trim(), challengeIntent.value, profile)
    ElMessage.success(challengeIntent.value === 'link' ? '新的登录方式已绑定' : '已登录服务器账号，请重新加入房间')
    challengeId.value = ''
    challengeIntent.value = null
    emailCode.value = ''
  } catch (error) {
    ElMessage.error(accountError(error))
  } finally {
    accountBusy.value = false
  }
}

const startGitHub = async () => {
  accountBusy.value = true
  try {
    await ensureLocalProfile()
    const authorizationUrl = await authStore.startGitHub(authStore.isAccount ? 'link' : 'login')
    window.location.assign(authorizationUrl)
  } catch (error) {
    ElMessage.error(accountError(error))
    accountBusy.value = false
  }
}

const unlinkIdentity = async (identity: AccountIdentity) => {
  try {
    await ElMessageBox.confirm(
      `确定解绑 ${identityProviderLabel(identity)} 身份 ${identity.subject} 吗？`,
      '解绑登录方式',
      { confirmButtonText: '解绑', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return
  }
  accountBusy.value = true
  try {
    await authStore.unlinkIdentity(identity)
    ElMessage.success('登录方式已解绑')
  } catch (error) {
    ElMessage.error(accountError(error))
  } finally {
    accountBusy.value = false
  }
}

const deactivateAccount = async () => {
  try {
    await ElMessageBox.confirm(
      '停用后，这个服务器账号的所有会话与房间权限都会被撤销，且无法自行登录恢复。本地档案不会删除。确定继续吗？',
      '停用服务器账号',
      { confirmButtonText: '停用账号', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return
  }
  accountBusy.value = true
  try {
    await authStore.deactivateAccount()
    ElMessage.success('账号已停用')
  } catch (error) {
    ElMessage.error(accountError(error))
  } finally {
    accountBusy.value = false
  }
}

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
onMounted(async () => {
  petResourceCache.initStats()
  try {
    await ensureLocalProfile()
  } catch (error) {
    ElMessage.error(accountError(error))
  }
  try {
    await authStore.refreshAccountContext()
  } catch (error) {
    ElMessage.error(accountError(error))
    return
  }
  if (!profileReady.value) return
  const callback = takeBootOAuthCallback()
  if (!callback) return
  if (callback.error) {
    ElMessage.error('GitHub 授权未完成，请重新发起登录。')
    return
  }
  if (!callback.code || !callback.state) return
  accountBusy.value = true
  try {
    await authStore.completeGitHub(callback.state, callback.code, localProfile())
    ElMessage.success('GitHub 身份验证成功；如已切换账号，请重新加入房间')
  } catch (error) {
    ElMessage.error(accountError(error))
  } finally {
    accountBusy.value = false
  }
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

.identity-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
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
