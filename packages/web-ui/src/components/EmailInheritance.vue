<template>
  <div class="email-inheritance">
    <!-- 用户状态说明 -->
    <el-alert
      v-if="!playerStore.is_registered"
      title="匿名用户模式"
      type="info"
      :closable="false"
      show-icon
      class="mb-4"
    >
      <p class="text-sm">您当前是匿名用户，数据仅保存在本设备。绑定邮箱后可在其他设备恢复您的玩家ID和所有数据。</p>
    </el-alert>

    <!-- 绑定邮箱卡片 -->
    <el-card v-if="!playerStore.is_registered" class="mb-4">
      <template #header>
        <div class="flex items-center">
          <el-icon class="mr-2"><Message /></el-icon>
          <span>绑定邮箱（可选）</span>
        </div>
      </template>

      <div class="space-y-4">
        <p class="text-gray-600 text-sm">
          <strong>可选功能：</strong>绑定邮箱后，您可以在其他设备上通过邮箱恢复您的玩家ID和所有数据。
          如果您只在当前设备使用，可以跳过此步骤。
        </p>

        <el-form :model="bindForm" :rules="bindRules" ref="bindFormRef" @submit.prevent>
          <el-form-item prop="email">
            <el-input v-model="bindForm.email" placeholder="请输入邮箱地址" :disabled="bindLoading">
              <template #prefix>
                <el-icon><Message /></el-icon>
              </template>
            </el-input>
          </el-form-item>

          <el-form-item v-if="bindForm.codeSent" prop="code">
            <el-input v-model="bindForm.code" placeholder="请输入6位验证码" maxlength="6" :disabled="bindLoading">
              <template #prefix>
                <el-icon><Key /></el-icon>
              </template>
            </el-input>
          </el-form-item>

          <el-form-item>
            <el-button
              v-if="!bindForm.codeSent"
              type="primary"
              @click="sendBindCode"
              :loading="bindLoading"
              :disabled="!bindForm.email"
            >
              发送验证码
            </el-button>

            <div v-else class="flex space-x-2">
              <el-button
                type="primary"
                @click="confirmBind"
                :loading="bindLoading"
                :disabled="!bindForm.code || bindForm.code.length !== 6"
              >
                确认绑定
              </el-button>

              <el-button @click="resendBindCode" :disabled="bindLoading || bindCountdown > 0">
                {{ bindCountdown > 0 ? `重发(${bindCountdown}s)` : '重新发送' }}
              </el-button>
            </div>
          </el-form-item>
        </el-form>
      </div>
    </el-card>

    <!-- 已绑定邮箱信息 -->
    <el-card v-if="playerStore.is_registered" class="mb-4">
      <template #header>
        <div class="flex items-center justify-between">
          <div class="flex items-center">
            <el-icon class="mr-2 text-green-500"><CircleCheck /></el-icon>
            <span>注册用户</span>
          </div>
          <el-button type="danger" size="small" @click="showUnbindDialog = true"> 转为匿名用户 </el-button>
        </div>
      </template>

      <div class="space-y-2">
        <p class="text-sm">
          <span class="text-gray-600">绑定邮箱：</span>
          <span class="font-medium">{{ playerStore.email }}</span>
        </p>
        <p class="text-sm">
          <span class="text-gray-600">绑定时间：</span>
          <span>{{ formatDate(playerStore.email_bound_at) }}</span>
        </p>
        <p class="text-xs text-green-600">✓ 您的玩家ID已与此邮箱绑定，可在其他设备上恢复</p>
        <p class="text-xs text-blue-600">ℹ️ 作为注册用户，您的数据可以跨设备同步</p>
      </div>
    </el-card>

    <!-- 恢复玩家ID卡片 -->
    <el-card>
      <template #header>
        <div class="flex items-center">
          <el-icon class="mr-2"><Refresh /></el-icon>
          <span>恢复玩家ID</span>
        </div>
      </template>

      <div class="space-y-4">
        <p class="text-gray-600 text-sm">如果您在其他设备上有绑定邮箱的玩家ID，可以通过邮箱恢复。</p>

        <el-form :model="recoverForm" :rules="recoverRules" ref="recoverFormRef" @submit.prevent>
          <el-form-item prop="email">
            <el-input v-model="recoverForm.email" placeholder="请输入已绑定的邮箱地址" :disabled="recoverLoading">
              <template #prefix>
                <el-icon><Message /></el-icon>
              </template>
            </el-input>
          </el-form-item>

          <el-form-item v-if="recoverForm.codeSent" prop="code">
            <el-input v-model="recoverForm.code" placeholder="请输入6位验证码" maxlength="6" :disabled="recoverLoading">
              <template #prefix>
                <el-icon><Key /></el-icon>
              </template>
            </el-input>
          </el-form-item>

          <el-form-item>
            <el-button
              v-if="!recoverForm.codeSent"
              type="primary"
              @click="sendRecoverCode"
              :loading="recoverLoading"
              :disabled="!recoverForm.email"
            >
              发送验证码
            </el-button>

            <div v-else class="flex space-x-2">
              <el-button
                type="primary"
                @click="confirmRecover"
                :loading="recoverLoading"
                :disabled="!recoverForm.code || recoverForm.code.length !== 6"
              >
                恢复玩家ID
              </el-button>

              <el-button @click="resendRecoverCode" :disabled="recoverLoading || recoverCountdown > 0">
                {{ recoverCountdown > 0 ? `重发(${recoverCountdown}s)` : '重新发送' }}
              </el-button>
            </div>
          </el-form-item>
        </el-form>
      </div>
    </el-card>

    <!-- 解绑确认对话框 -->
    <el-dialog v-model="showUnbindDialog" title="转为匿名用户" width="400px" :before-close="handleUnbindDialogClose">
      <div class="space-y-4">
        <el-alert title="警告" type="warning" :closable="false" show-icon>
          解绑邮箱后，您将转为匿名用户，无法在其他设备上恢复此玩家ID。 数据将仅保存在当前设备上。
        </el-alert>

        <p class="text-sm text-gray-600">
          当前玩家ID：<code class="bg-gray-100 px-2 py-1 rounded">{{ playerStore.id }}</code>
        </p>

        <p class="text-xs text-gray-500">提示：您随时可以重新绑定邮箱来恢复注册用户身份。</p>
      </div>

      <template #footer>
        <div class="flex justify-end space-x-2">
          <el-button @click="showUnbindDialog = false">取消</el-button>
          <el-button type="danger" @click="confirmUnbind" :loading="unbindLoading"> 确认转为匿名用户 </el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { Message, Key, CircleCheck, Refresh } from '@element-plus/icons-vue'
import { usePlayerStore } from '@/stores/player'
import { emailInheritanceService } from '@/services/emailInheritanceService'
import type { PlayerInfo } from '@/stores/auth'
import { useBattleClientStore } from '@/stores/battleClient'

// 定义props和emits
interface Props {
  visible?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
})

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'player-upgraded': [playerInfo: PlayerInfo]
}>()

const playerStore = usePlayerStore()
const battleClientStore = useBattleClientStore()

// 绑定表单
const bindForm = reactive({
  email: '',
  code: '',
  codeSent: false,
})

const bindFormRef = ref<FormInstance>()
const bindLoading = ref(false)
const bindCountdown = ref(0)
let bindCountdownTimer: ReturnType<typeof setTimeout> | null = null

// 恢复表单
const recoverForm = reactive({
  email: '',
  code: '',
  codeSent: false,
})

const recoverFormRef = ref<FormInstance>()
const recoverLoading = ref(false)
const recoverCountdown = ref(0)
let recoverCountdownTimer: ReturnType<typeof setTimeout> | null = null

// 解绑相关
const showUnbindDialog = ref(false)
const unbindLoading = ref(false)

// 表单验证规则
const bindRules: FormRules = {
  email: [
    { required: true, message: '请输入邮箱地址', trigger: 'blur' },
    { type: 'email', message: '邮箱格式不正确', trigger: 'blur' },
  ],
  code: [
    { required: true, message: '请输入验证码', trigger: 'blur' },
    { len: 6, message: '验证码必须是6位数字', trigger: 'blur' },
    { pattern: /^\d{6}$/, message: '验证码只能包含数字', trigger: 'blur' },
  ],
}

const recoverRules: FormRules = {
  email: [
    { required: true, message: '请输入邮箱地址', trigger: 'blur' },
    { type: 'email', message: '邮箱格式不正确', trigger: 'blur' },
  ],
  code: [
    { required: true, message: '请输入验证码', trigger: 'blur' },
    { len: 6, message: '验证码必须是6位数字', trigger: 'blur' },
    { pattern: /^\d{6}$/, message: '验证码只能包含数字', trigger: 'blur' },
  ],
}

// 发送绑定验证码
const sendBindCode = async () => {
  if (!bindFormRef.value) return

  const valid = await bindFormRef.value.validateField('email')
  if (!valid) return

  bindLoading.value = true
  try {
    const response = await emailInheritanceService.sendVerificationCode({
      email: bindForm.email,
      playerId: playerStore.id,
      purpose: 'bind',
    })

    if (response.success) {
      bindForm.codeSent = true
      ElMessage.success(response.message)
      startBindCountdown()
    } else {
      ElMessage.error(response.message)
      if (response.rateLimitSeconds) {
        bindCountdown.value = response.rateLimitSeconds
        startBindCountdown()
      }
    }
  } catch (error) {
    ElMessage.error('发送验证码失败，请检查网络连接')
  } finally {
    bindLoading.value = false
  }
}

// 确认绑定
const confirmBind = async () => {
  if (!bindFormRef.value) return

  const valid = await bindFormRef.value.validate()
  if (!valid) return

  bindLoading.value = true
  try {
    const response = await emailInheritanceService.bindEmail(bindForm.email, bindForm.code, playerStore.id)

    if (response.success) {
      ElMessage.success(response.message)

      // 如果返回了认证信息，设置到认证服务中
      if (response.auth) {
        const { useAuthStore } = await import('../stores/auth')
        const authStore = useAuthStore()
        // 构造完整的AuthResult对象
        const authResult = {
          ...response.auth,
          player: {
            ...response.auth.player,
            name: response.player.name, // 从player对象中获取name
            isRegistered: response.auth.player.isRegistered,
            email: response.auth.player.email,
          },
        }
        authStore.setTokens(authResult)
      }

      // 创建PlayerInfo对象
      const playerInfo: PlayerInfo = {
        id: response.player.id,
        name: response.player.name,
        isRegistered: response.player.is_registered || false,
        email: response.player.email || undefined,
        emailVerified: response.player.email_verified || false,
        emailBoundAt: response.player.email_bound_at || undefined,
      }

      // 触发升级事件
      emit('player-upgraded', playerInfo)

      // 更新玩家信息
      playerStore.$patch({
        email: response.player.email,
        email_verified: response.player.email_verified,
        email_bound_at: response.player.email_bound_at,
        is_registered: response.player.is_registered, // 更新注册状态
        requiresAuth: true, // 注册用户需要认证
        isAuthenticated: response.auth ? true : false, // 如果有认证信息则已认证
        isInitialized: false, // 标记为未初始化，以便重新初始化
      })

      // 重置表单
      resetBindForm()

      // 重新初始化玩家数据以确保状态同步
      await playerStore.initializePlayer()

      // 重新初始化battleClient以使用新的认证信息
      try {
        battleClientStore.reset()
        battleClientStore.initialize()
        await battleClientStore.connect()
        console.log('BattleClient重新连接成功，使用新的认证信息')
      } catch (error) {
        console.warn('BattleClient重新连接失败:', error)
        // 不阻塞用户操作，只是记录警告
      }

      ElMessage.success('邮箱绑定成功，您现在是注册用户')
    } else {
      ElMessage.error(response.message)
    }
  } catch (error) {
    ElMessage.error('邮箱绑定失败，请检查网络连接')
  } finally {
    bindLoading.value = false
  }
}

// 重新发送绑定验证码
const resendBindCode = () => {
  bindForm.codeSent = false
  bindForm.code = ''
  sendBindCode()
}

// 发送恢复验证码
const sendRecoverCode = async () => {
  if (!recoverFormRef.value) return

  const valid = await recoverFormRef.value.validateField('email')
  if (!valid) return

  recoverLoading.value = true
  try {
    const response = await emailInheritanceService.sendVerificationCode({
      email: recoverForm.email,
      purpose: 'recover',
    })

    if (response.success) {
      recoverForm.codeSent = true
      ElMessage.success(response.message)
      startRecoverCountdown()
    } else {
      ElMessage.error(response.message)
      if (response.rateLimitSeconds) {
        recoverCountdown.value = response.rateLimitSeconds
        startRecoverCountdown()
      }
    }
  } catch (error) {
    ElMessage.error('发送验证码失败，请检查网络连接')
  } finally {
    recoverLoading.value = false
  }
}

// 确认恢复
const confirmRecover = async () => {
  if (!recoverFormRef.value) return

  const valid = await recoverFormRef.value.validate()
  if (!valid) return

  try {
    const result = await ElMessageBox.confirm('恢复玩家ID将替换当前的玩家数据，是否继续？', '确认恢复', {
      confirmButtonText: '确认',
      cancelButtonText: '取消',
      type: 'warning',
    })

    if (result !== 'confirm') return
  } catch {
    return
  }

  recoverLoading.value = true
  try {
    const response = await emailInheritanceService.recoverPlayer(recoverForm.email, recoverForm.code)

    if (response.success) {
      ElMessage.success(response.message)

      // 如果返回了认证信息，设置到认证服务中
      if (response.auth) {
        const { useAuthStore } = await import('../stores/auth')
        const authStore = useAuthStore()
        // 构造完整的AuthResult对象
        const authResult = {
          ...response.auth,
          player: {
            ...response.auth.player,
            name: response.player.name, // 从player对象中获取name
            isRegistered: response.auth.player.isRegistered,
            email: response.auth.player.email,
          },
        }
        authStore.setTokens(authResult)
      }

      // 更新玩家信息
      playerStore.$patch({
        id: response.player.id,
        name: response.player.name,
        email: response.player.email,
        email_verified: response.player.email_verified,
        email_bound_at: response.player.email_bound_at,
        is_registered: response.player.is_registered, // 更新注册状态
        requiresAuth: response.player.is_registered || false,
        isAuthenticated: response.auth ? true : false, // 如果有认证信息则已认证
        isInitialized: false, // 标记为未初始化，以便重新初始化
      })

      // 重置表单
      resetRecoverForm()

      // 触发玩家数据重新初始化，而不是刷新页面
      await playerStore.initializePlayer()

      // 重新初始化battleClient以使用新的玩家ID和认证信息
      try {
        battleClientStore.reset()
        battleClientStore.initialize()
        await battleClientStore.connect()
        console.log('BattleClient重新连接成功，使用恢复的玩家ID和认证信息')
      } catch (error) {
        console.warn('BattleClient重新连接失败:', error)
        // 不阻塞用户操作，只是记录警告
      }

      ElMessage.success('玩家ID恢复成功，数据已更新')
    } else {
      ElMessage.error(response.message)
    }
  } catch (error) {
    ElMessage.error('玩家ID恢复失败，请检查网络连接')
  } finally {
    recoverLoading.value = false
  }
}

// 重新发送恢复验证码
const resendRecoverCode = () => {
  recoverForm.codeSent = false
  recoverForm.code = ''
  sendRecoverCode()
}

// 确认解绑
const confirmUnbind = async () => {
  unbindLoading.value = true
  try {
    const response = await emailInheritanceService.unbindEmail(playerStore.id)

    if (response.success) {
      ElMessage.success(response.message)
      // 更新玩家信息
      playerStore.$patch({
        email: null,
        email_verified: false,
        email_bound_at: null,
        is_registered: false, // 转回匿名用户
      })

      // 重新初始化battleClient以使用游客模式
      try {
        battleClientStore.reset()
        battleClientStore.initialize()
        await battleClientStore.connect()
        console.log('BattleClient重新连接成功，已切换到游客模式')
      } catch (error) {
        console.warn('BattleClient重新连接失败:', error)
        // 不阻塞用户操作，只是记录警告
      }

      showUnbindDialog.value = false
    } else {
      ElMessage.error(response.message)
    }
  } catch (error) {
    ElMessage.error('邮箱解绑失败，请检查网络连接')
  } finally {
    unbindLoading.value = false
  }
}

// 处理解绑对话框关闭
const handleUnbindDialogClose = (done: () => void) => {
  if (!unbindLoading.value) {
    done()
  }
}

// 倒计时相关
const startBindCountdown = () => {
  bindCountdown.value = 60
  bindCountdownTimer = setInterval(() => {
    bindCountdown.value--
    if (bindCountdown.value <= 0) {
      clearInterval(bindCountdownTimer!)
      bindCountdownTimer = null
    }
  }, 1000)
}

const startRecoverCountdown = () => {
  recoverCountdown.value = 60
  recoverCountdownTimer = setInterval(() => {
    recoverCountdown.value--
    if (recoverCountdown.value <= 0) {
      clearInterval(recoverCountdownTimer!)
      recoverCountdownTimer = null
    }
  }, 1000)
}

// 重置表单
const resetBindForm = () => {
  bindForm.email = ''
  bindForm.code = ''
  bindForm.codeSent = false
  bindFormRef.value?.resetFields()
}

const resetRecoverForm = () => {
  recoverForm.email = ''
  recoverForm.code = ''
  recoverForm.codeSent = false
  recoverFormRef.value?.resetFields()
}

// 格式化日期
const formatDate = (dateString: string | null) => {
  if (!dateString) return '未知'
  return new Date(dateString).toLocaleString('zh-CN')
}

// 清理定时器
onUnmounted(() => {
  if (bindCountdownTimer) {
    clearInterval(bindCountdownTimer)
  }
  if (recoverCountdownTimer) {
    clearInterval(recoverCountdownTimer)
  }
})
</script>

<style scoped>
.email-inheritance {
  max-width: 600px;
  margin: 0 auto;
}

code {
  font-family: 'Courier New', monospace;
  font-size: 0.9em;
}
</style>
