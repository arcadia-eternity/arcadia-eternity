<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{
  id: number
}>()

const petIconUrl = computed(
  () => `https://cdn.jsdelivr.net/gh/arcadia-star/seer2-resource@main/png-4x/petIcon/${props.id}.png`,
)
</script>

<template>
  <img
    :src="petIconUrl"
    :alt="`Pet icon ${id}`"
    class="pet-icon"
    @error="e => (e.target!.src = 'https://placehold.co/100x100?text=No+Image')"
  />
</template>

<style scoped>
.pet-icon {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
</style>
