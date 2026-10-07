<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ value: number | string; kind: 'hp' | 'rage' }>()
// Trusted, repository-owned vector exports; no user content is inserted as markup.
const glyphs = import.meta.glob<string>('../../assets/battle/numbers/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const digits = computed(() =>
  String(props.value)
    .split('')
    .map(char => ({
      char,
      svg: glyphs[`../../assets/battle/numbers/${props.kind}-${char === '/' ? 'slash' : char}.svg`],
    })),
)
</script>
<template>
  <span class="battle-bar-number" role="img" :aria-label="String(value)">
    <span v-for="(digit, index) in digits" :key="index" aria-hidden="true" class="battle-bar-number__glyph">
      <!-- eslint-disable-next-line vue/no-v-html -->
      <span v-if="digit.svg" v-html="digit.svg"></span>
      <span v-else>{{ digit.char }}</span>
    </span>
  </span>
</template>
<style scoped>
.battle-bar-number {
  display: inline-flex;
  vertical-align: top;
  line-height: 1;
  white-space: nowrap;
  gap: 0;
}
.battle-bar-number__glyph {
  display: inline-flex;
}
.battle-bar-number__glyph :deep(svg) {
  display: block;
  height: 16px;
  width: auto;
}
</style>
