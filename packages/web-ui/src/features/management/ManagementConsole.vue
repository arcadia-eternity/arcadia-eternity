<script setup lang="ts">
import { ElConfigProvider, ElButton, ElAlert, ElDrawer, ElTag } from 'element-plus'
import { ref, watch } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { useManagementController, type ManagementConsoleProps, type ManagementTab } from './useManagementController'
import ManagementLogin from './ManagementLogin.vue'
import ManagementNavigation from './ManagementNavigation.vue'
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
  isAdministrator,
  localBridge,
  target,
  sidebarOpen,
  settingsSaveSequence,
  tab,
  activeOperations,
  supported,
  accessibleTabs,
  changeTarget,
  logout,
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
          <RouterLink
            :to="{
              path: '/environments',
              query: { target },
            }"
            ><ElButton text>环境</ElButton></RouterLink
          >
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
            :can-read-players="isAdministrator"
            :can-read-battles="isAdministrator"
            :can-manage-accounts="supported('accounts') && isAdministrator"
            :can-terminate="isAdministrator"
            :more-accounts="!!accountCursor"
            :busy="busy"
            @terminate="terminateBattle"
            @deactivate="deactivateAccount"
            @more-accounts="state.loadMoreAccounts"
          >
          </LiveManagement>

          <ServerSettingsForm
            v-if="tab === 'network' && server?.settings"
            :settings="server.settings"
            :revision="server.revision"
            :save-sequence="settingsSaveSequence"
            :runtime-settings="server.runtimeSettings"
            :listen-address="server.listenAddress"
            :pending-restart="server.pendingRestart"
            :busy="busy"
            :can-edit="isAdministrator"
            @save="saveServerSettings"
          >
          </ServerSettingsForm>
          <ManagementOverview :controller="controller"> </ManagementOverview>
          <ManagementTasks :controller="controller"> </ManagementTasks>
          <ManagementPermissions :controller="controller"> </ManagementPermissions>
        </div>
      </div>
      <div v-else class="management-login-scroll">
        <ManagementLogin :controller="controller" />
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
