<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'

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
  () => `https://cdn.jsdelivr.net/gh/arcadia-star/seer2-resource@main/png/petIcon/${props.id}.png`,
)

const effectiveUrl = ref(petIconUrl.value)

function checkImage() {
  const img = new Image()
  img.src = petIconUrl.value
  img.onload = () => {
    effectiveUrl.value = petIconUrl.value
  }
  img.onerror = () => {
    effectiveUrl.value = 'https://placehold.co/100x100?text=No+Image'
  }
}

onMounted(checkImage)
watch(petIconUrl, checkImage)
</script>

<template>
  <div
    :style="{ backgroundImage: `url(${effectiveUrl})` }"
    :aria-label="`Pet icon ${id}`"
    role="img"
    class="pet-icon"
    :class="{ reverse: reverse }"
  />
</template>

<style scoped>
.pet-icon {
  background-size: contain;
  background-position: center;
  background-repeat: no-repeat;
}

.pet-icon.reverse {
  transform: scaleX(-1);
}
</style>
