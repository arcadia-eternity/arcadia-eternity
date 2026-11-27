<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { ChatBubbleLeftRightIcon, ClipboardDocumentIcon } from '@heroicons/vue/24/outline'
import CreatorDocsLink from '@/features/authoring/CreatorDocsLink.vue'
import { readTerminalCommands, shellCommand } from '@/features/authoring/terminalCommands'
import { isDesktop } from '@/utils/env'
import { getVersionInfo } from '@/utils/version'

const canAuthor = !!window.arcadiaDesktop?.author
const copying = ref(false)
const copied = ref(false)
const error = ref('')
const manualCopy = ref('')
const copyField = ref<HTMLTextAreaElement>()

async function copyStarter() {
  if (copying.value) return
  copying.value = true
  copied.value = false
  error.value = ''
  manualCopy.value = ''
  try {
    let command: string
    if (canAuthor) {
      const { shell, commandPaths } = await readTerminalCommands()
      command = shellCommand(commandPaths['arcadia-content'], shell)
    } else {
      command = 'npm exec --package=@arcadia-eternity/content-sdk@' + getVersionInfo().version + ' -- arcadia-content'
    }
    const prompt = [
      '我想为 Arcadia Eternity 创作。先问我想做什么：可以是精灵、技能或印记，也可以是使用已有内容的对战赛制。',
      canAuthor ? '请使用桌面客户端随附的创作工具。' : '请在本机使用 Node.js 24 和 npm 运行创作工具。',
      '先运行 ' + command + ' commands --json，查看这个版本支持的操作。',
      '根据我的点子选择内容包（init pack）或独立赛制（init environment）。和我确定项目名称和保存位置后，用同一条创作命令在新目录初始化项目。',
      '在同一条命令后加 workspace <项目目录> describe 核对创建结果，告诉我项目的完整路径。读取项目里的 skills/arcadia-content-authoring/SKILL.md，带我完成第一个可验证的小改动。',
      '如果我想让你读取工作台里选中的对象或未保存的草稿，提醒我在桌面客户端的「创作」打开项目文件夹，进入「AI 助手」复制该项目的连接提示词。',
    ].join('\n\n')
    try {
      await navigator.clipboard.writeText(prompt)
      copied.value = true
    } catch {
      manualCopy.value = prompt
      await nextTick()
      copyField.value?.focus()
      copyField.value?.select()
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    copying.value = false
  }
}
</script>

<template>
  <section class="creation-start" aria-labelledby="creation-title">
    <header>
      <h1 id="creation-title">创作</h1>
      <CreatorDocsLink @error="message => (error = message)" />
    </header>
    <section class="assistant-start" aria-labelledby="assistant-start-title">
      <div>
        <h2 id="assistant-start-title"><ChatBubbleLeftRightIcon aria-hidden="true" />用 AI 开始创作</h2>
        <p>把提示词粘贴到能运行本机命令的 AI 助手（如 Codex 或 Claude Code），告诉它你想做的精灵、技能或赛制。</p>
      </div>
      <button class="copy-button" type="button" :disabled="copying" @click="copyStarter">
        <ClipboardDocumentIcon aria-hidden="true" />复制起步提示词
      </button>
    </section>
    <p v-if="copied" role="status">已复制，可粘贴到 AI 助手中。</p>
    <label v-if="manualCopy" class="manual-copy">
      请手动复制起步提示词
      <textarea ref="copyField" :value="manualCopy" readonly rows="5" />
    </label>
    <p v-if="error" role="alert">{{ error }}</p>
    <slot />
    <p v-if="!isDesktop" class="download-link">
      使用网页提示词建项目需要 Node.js 24 和 npm。也可以<RouterLink :to="{ name: 'Download' }"
        >下载桌面客户端</RouterLink
      >使用内置创作工具。
    </p>
  </section>
</template>

<style scoped>
.creation-start {
  box-sizing: border-box;
  max-width: 1280px;
  margin: 0 auto;
  padding: 16px clamp(12px, 2vw, 20px) 0;
}
header,
.assistant-start,
h2,
.copy-button {
  display: flex;
  align-items: center;
  gap: 8px;
}
header,
.assistant-start {
  justify-content: space-between;
  flex-wrap: wrap;
}
h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
}
h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}
.assistant-start {
  margin-top: 14px;
  padding: 16px;
  gap: 12px;
  color: #1e3a5f;
  border: 1px solid #c8d9ec;
  border-radius: 8px;
  background: #f4f8fd;
}
.assistant-start p {
  margin: 6px 0 0;
  font-size: 14px;
}
svg {
  width: 20px;
  height: 20px;
}
.copy-button {
  padding: 8px 12px;
  border-radius: 5px;
  background: #245ea0;
  color: white;
  font-weight: 500;
  cursor: pointer;
}
.copy-button:hover {
  background: #184d88;
}
a {
  color: #245ea0;
  text-decoration: underline;
}
.manual-copy,
textarea {
  display: block;
  width: 100%;
}
textarea {
  padding: 8px;
  border: 1px solid currentColor;
}
.download-link,
.manual-copy,
[role='status'],
[role='alert'] {
  margin: 12px 0;
}
[role='alert'] {
  color: #a12622;
}
</style>
