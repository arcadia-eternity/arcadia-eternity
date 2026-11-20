<script setup lang="ts">
import { ElButton, ElCheckbox, ElForm, ElFormItem, ElInput } from 'element-plus'
import { allowManagementAccount } from '@/services/managementSession'
import type { ManagementController } from './useManagementController'
const { controller } = defineProps<{
  controller: ManagementController
}>()
const {
  loginRequired,
  target,
  busy,
  signingIn,
  passkeyAvailable,
  loginPasskey,
  accountLoginSupported,
  accountLoginAvailable,
  client,
  remember,
  login,
  loginCode,
} = controller
</script>
<template>
  <section v-if="loginRequired && target === 'server'" class="login-card" aria-label="管理员登录">
    <h2>登录管理后台</h2>
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
          <ElInput v-model="loginCode" type="password" required autocomplete="off" :disabled="busy || signingIn" />
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
</template>
