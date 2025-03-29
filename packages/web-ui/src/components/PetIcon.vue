<script setup lang="ts">
import { computed } from 'vue'
const props = withDefaults(
  defineProps<{
    id: number
    reverse?: boolean
  }>(),
  {
    id: 999,
    reverse: false,
  },
)

const petIconUrl = computed(
  () => `https://cdn.jsdelivr.net/gh/arcadia-star/seer2-resource@main/png-4x/petIcon/${props.id}.png`,
)
</script>

<template>
  <img
    :src="petIconUrl"
    :alt="`Pet icon ${id}`"
    class="pet-icon"
    :class="{ reverse: reverse }"
    @error="e => ((e.target as HTMLImageElement).src = 'https://placehold.co/100x100?text=No+Image')"
  />
</template>

<style scoped>
.pet-icon {
  object-fit: contain;
}

.pet-icon.reverse {
  transform: scaleX(-1);
}
</style>
