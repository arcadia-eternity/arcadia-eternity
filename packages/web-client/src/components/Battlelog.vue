<template>
  <div class="battle-log">
    <div v-for="(msg, index) in messages" :key="index" class="log-entry">[{{ msg.type }}] {{ formatMessage(msg) }}</div>
  </div>
</template>

<script setup>
const props = defineProps({
  messages: Array,
})

const formatMessage = msg => {
  switch (msg.type) {
    case 'DAMAGE':
      return `${msg.data.target} 受到 ${msg.data.damage} 伤害`
    case 'SKILL_USE':
      return `${msg.data.user} 使用 ${msg.data.skill}`
    // 其他消息格式化...
    default:
      return JSON.stringify(msg.data)
  }
}
</script>
