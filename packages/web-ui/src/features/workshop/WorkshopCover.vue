<script setup lang="ts">
import { computed } from 'vue'
import { Box, Grid } from '@element-plus/icons-vue'
import { ElIcon } from 'element-plus'

const props = defineProps<{ id: string; title: string; kind: string; size?: 'card' | 'hero' }>()

const hue = computed(() => {
  let hash = 0
  for (const char of props.id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash % 360
})
const initial = computed(() => [...props.title.replace(/^[\d\s·.]+/, '')][0] ?? '?')
</script>

<template>
  <div class="workshop-cover" :class="size ?? 'card'" :style="{ '--hue': hue }" aria-hidden="true">
    <span class="initial">{{ initial }}</span>
    <ElIcon class="kind"><Grid v-if="kind === 'environment'" /><Box v-else /></ElIcon>
  </div>
</template>

<style scoped>
.workshop-cover {
  position: relative;
  display: grid;
  place-items: center;
  overflow: hidden;
  background:
    radial-gradient(circle at 78% 18%, hsl(calc(var(--hue) + 40) 85% 72% / 0.55), transparent 46%),
    linear-gradient(135deg, hsl(var(--hue) 62% 46%), hsl(calc(var(--hue) + 28) 70% 30%));
  color: #fff;
}
.workshop-cover::after {
  content: '';
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(-45deg, rgb(255 255 255 / 0.05) 0 2px, transparent 2px 12px);
}
.card {
  aspect-ratio: 16 / 7;
}
.hero {
  aspect-ratio: 16 / 6;
  border-radius: 12px;
}
.initial {
  font-size: 44px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-shadow: 0 2px 12px rgb(0 0 0 / 0.25);
}
.hero .initial {
  font-size: 64px;
}
.kind {
  position: absolute;
  right: 12px;
  bottom: 10px;
  z-index: 1;
  font-size: 18px;
  opacity: 0.85;
}
</style>
