<script setup lang="ts">
import {
  ElConfigProvider,
  ElButton,
  ElCheckbox,
  ElForm,
  ElFormItem,
  ElInput,
  ElAlert,
  ElDrawer,
  ElTag,
} from 'element-plus'
import { ref, watch } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { useManagementController, type ManagementConsoleProps, type ManagementTab } from './useManagementController'
import { allowManagementAccount } from '@/services/managementSession'
import ManagementNavigation from './ManagementNavigation.vue'
import ManagementEnvironments from './ManagementEnvironments.vue'
import ManagementOverview from './ManagementOverview.vue'
import ManagementTasks from './ManagementTasks.vue'
import ManagementPermissions from './ManagementPermissions.vue'
import ManagementSecurity from './ManagementSecurity.vue'
import LiveManagement from './LiveManagement.vue'
import ServerSettingsForm from './ServerSettingsForm.vue'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import './managementStyles'
import './management.css'
const props = defineProps<ManagementConsoleProps>()
const emit = defineEmits<{ navigate: [value: { target: 'local' | 'server'; tab: ManagementTab }] }>()
const controller = useManagementController(props, emit)
const {
  state,
  client,
  capabilities,
  managementPrincipalId,
  server,
  accounts,
  players,
  battles,
  accountCursor,
  loading,
  busy,
  loginRequired,
  error,
  notice,
  can,
  localBridge,
  target,
  loginCode,
  remember,
  accountLoginSupported,
  signingIn,
  sidebarOpen,
  passkeyAvailable,
  settingsSaveSequence,
  tab,
  activeOperations,
  supported,
  accessibleTabs,
  accountLoginAvailable,
  changeTarget,
  login,
  logout,
  loginPasskey,
  terminateBattle,
  saveServerSettings,
  deactivateAccount,
} = controller
const contentPane = ref<HTMLElement>()
const compact = useMediaQuery('(max-width: 800px)')
watch(tab, () => {
  if (contentPane.value) contentPane.value.scrollTop = 0
})
watch(compact, () => {
  sidebarOpen.value = false
})
</script>
<template>
  <ElConfigProvider :locale="zhCn">
    <section class="management-console" aria-label="管理控制台">
      <div class="management-heading">
        <div class="management-context">
          <span class="management-eyebrow">管理控制台</span>
          <strong>{{ client?.context.label ?? '正在连接…' }}</strong>
          <ElTag v-if="capabilities" size="small" effect="plain">{{
            target === 'local' ? '本机服主' : '已验证管理员'
          }}</ElTag>
        </div>
        <div class="actions">
          <ElButton v-if="capabilities && compact" :aria-expanded="sidebarOpen" @click="sidebarOpen = true"
            >管理菜单</ElButton
          >
          <template v-if="localBridge">
            <ElButton :type="target === 'local' ? 'primary' : 'default'" @click="changeTarget('local')"
              >本机服务器</ElButton
            >
            <ElButton :type="target === 'server' ? 'primary' : 'default'" @click="changeTarget('server')"
              >当前部署服务器</ElButton
            >
          </template>
          <RouterLink to="/servers">
            <ElButton text>服务器列表</ElButton>
          </RouterLink>
          <RouterLink to="/">
            <ElButton text>返回游戏</ElButton>
          </RouterLink>
          <ElButton v-if="capabilities" :loading="loading" :disabled="busy" @click="state.refresh">刷新</ElButton>
          <ElButton v-if="target === 'server' && capabilities && !loginRequired" @click="logout">退出管理</ElButton>
        </div>
      </div>
      <div v-if="error || notice || capabilities?.resourceRestrictions.length" class="management-notices">
        <ElAlert v-if="error" :title="error" type="error" show-icon :closable="false" role="alert" />
        <ElAlert v-if="notice" :title="notice" type="success" show-icon :closable="false" role="status" />
        <ElAlert
          v-for="(restriction, index) in capabilities?.resourceRestrictions"
          :key="index"
          :title="restriction.reason"
          type="warning"
          :closable="false"
          show-icon
        />
      </div>
      <div v-if="capabilities && !loginRequired" class="console-layout">
        <aside v-if="!compact" class="console-sidebar">
          <ManagementNavigation
            :tab="tab"
            :available="accessibleTabs"
            :active-operations="activeOperations"
            @select="tab = $event"
          >
          </ManagementNavigation>
          <p class="management-identity">{{ managementPrincipalId || '本机服主' }}</p>
        </aside>
        <div ref="contentPane" class="console-content" tabindex="0" role="region" aria-label="管理内容">
          <ManagementSecurity
            v-if="tab === 'security' && target === 'server' && client"
            :key="client.context.endpoint"
            :client="client"
          >
          </ManagementSecurity>
          <LiveManagement
            v-if="tab === 'battles' || tab === 'accounts'"
            :key="client?.context.endpoint + ':' + tab"
            :mode="tab"
            :players="players"
            :battles="battles"
            :accounts="accounts"
            :can-read-players="can('server', 'players.read')"
            :can-read-battles="can('server', 'battles.read')"
            :can-manage-accounts="supported('accounts') && can('server', 'accounts.manage')"
            :can-terminate="can('server', 'battles.terminate')"
            :more-accounts="!!accountCursor"
            :busy="busy"
            @terminate="terminateBattle"
            @deactivate="deactivateAccount"
            @more-accounts="state.loadMoreAccounts"
          >
          </LiveManagement>
          <ManagementEnvironments :controller="controller"> </ManagementEnvironments>
          <ServerSettingsForm
            v-if="tab === 'network' && server?.settings"
            :settings="server.settings"
            :revision="server.revision"
            :save-sequence="settingsSaveSequence"
            :runtime-settings="server.runtimeSettings"
            :listen-address="server.listenAddress"
            :pending-restart="server.pendingRestart"
            :busy="busy"
            :can-edit="can('server', 'settings.manage')"
            @save="saveServerSettings"
          >
          </ServerSettingsForm>
          <ManagementOverview :controller="controller"> </ManagementOverview>
          <ManagementTasks :controller="controller"> </ManagementTasks>
          <ManagementPermissions :controller="controller"> </ManagementPermissions>
        </div>
      </div>
      <div v-else class="management-login-scroll">
        <section v-if="loginRequired && target === 'server'" class="login-card" aria-label="管理员登录">
          <span class="login-eyebrow">ARCADIA ETERNITY</span>
          <h2>登录管理后台</h2>
          <p>使用管理员身份管理此服务器。</p>
          <ElButton
            class="primary login-primary"
            :disabled="busy || signingIn || !passkeyAvailable"
            @click="loginPasskey"
            native-type="button"
            type="primary"
            >{{ signingIn ? '请在设备上完成验证…' : '使用通行密钥登录' }}</ElButton
          >
          <p v-if="!passkeyAvailable" class="hint">通行密钥需要 HTTPS 或 localhost，以及支持此功能的浏览器。</p>
          <RouterLink
            v-if="accountLoginSupported || accountLoginAvailable"
            class="account-login"
            to="/account?returnTo=management"
            @click="client && allowManagementAccount(client.context.endpoint)"
            >使用已授权账户登录</RouterLink
          >
          <ElCheckbox class="remember-device" v-model="remember">记住此设备 30 天（仅限私人设备）</ElCheckbox>
          <details class="bootstrap-help">
            <summary>首次设置或恢复管理员访问</summary>
            <p>在服务器主机上运行，使用实际数据目录：</p>
            <pre>
<code>node dist/cli.js server admin login-code --data-dir /path/to/server-data</code>
</pre>
            <p>
              自定义工作区时追加相同的 <code>--workspace-root</code>。登录码有效期 10
              分钟，仅能使用一次。进入后可在“登录与安全”添加通行密钥。
            </p>
            <ElForm @submit.prevent="login" label-position="top">
              <ElFormItem label="一次性登录码">
                <ElInput
                  v-model="loginCode"
                  type="password"
                  required
                  autocomplete="off"
                  :disabled="busy || signingIn"
                />
              </ElFormItem>
              <ElButton
                class="primary"
                :disabled="busy || signingIn || !loginCode.trim()"
                native-type="submit"
                type="primary"
                >{{ busy ? '正在验证…' : '使用登录码进入' }}</ElButton
              >
            </ElForm>
          </details>
        </section>
        <ElAlert v-if="loading && !loginRequired" title="正在读取管理信息…" type="info" :closable="false" />
      </div>
      <ElDrawer
        v-model="sidebarOpen"
        title="管理菜单"
        direction="ltr"
        size="min(300px, 90vw)"
        :append-to-body="true"
        class="management-navigation-drawer"
      >
        <ManagementNavigation
          :tab="tab"
          :available="accessibleTabs"
          :active-operations="activeOperations"
          @select="
            value => {
              tab = value
              sidebarOpen = false
            }
          "
        >
        </ManagementNavigation>
      </ElDrawer>
    </section>
  </ElConfigProvider>
</template>
