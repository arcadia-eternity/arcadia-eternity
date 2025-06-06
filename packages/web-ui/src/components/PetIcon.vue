<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'

const props = withDefaults(
  defineProps<{
    id: number
    reverse?: boolean
    isUnknown?: boolean
  }>(),
  {
    id: 999,
    reverse: false,
    isUnknown: false,
  },
)

const unknownPetUrl = 'https://cdn.jsdelivr.net/gh/arcadia-star/seer2-resource@main/png/battle/unknownPet.png'

const petIconUrl = computed(
  () => `https://cdn.jsdelivr.net/gh/arcadia-star/seer2-resource@main/png/petIcon/${props.id}.png`,
)

const effectiveUrl = ref(props.isUnknown ? unknownPetUrl : petIconUrl.value)

function checkImage() {
  // 如果明确标记为未知，直接使用未知图标
  if (props.isUnknown) {
    effectiveUrl.value = unknownPetUrl
    return
  }

  const img = new Image()
  img.src = petIconUrl.value
  img.onload = () => {
    effectiveUrl.value = petIconUrl.value
  }
  img.onerror = () => {
    effectiveUrl.value = unknownPetUrl
  }
}

onMounted(checkImage)
watch(petIconUrl, checkImage)
watch(() => props.isUnknown, checkImage)
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
