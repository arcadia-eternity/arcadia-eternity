<script setup lang="ts">
import unknownPet from '@/assets/images/unknown-pet.svg'
import { officialAssetUrl } from '@/utils/officialAssetUrl'
import { ref, computed, watch, onMounted } from 'vue'
import { useMediaImage } from '@/composition/useMediaImage'
import type { SpeciesSchemaType } from '@arcadia-eternity/schema'

const props = withDefaults(
  defineProps<{
    id?: number
    species?: Partial<SpeciesSchemaType>
    reverse?: boolean
    isUnknown?: boolean
  }>(),
  {
    id: 999,
    reverse: false,
    isUnknown: false,
  },
)

const imageFailed = ref(false)

const petIconUrl = computed(() =>
  typeof props.species?.presentation?.icon === 'string'
    ? officialAssetUrl(props.species.presentation.icon)
    : unknownPet,
)

const { url: sourceUrl, error: sourceError } = useMediaImage(
  () => petIconUrl.value,
  () => !props.isUnknown,
)
const effectiveUrl = ref(sourceUrl.value)

function checkImage() {
  // 如果明确标记为未知，直接使用未知图标
  if (props.isUnknown) {
    imageFailed.value = true
    return
  }

  const img = new Image()
  const expected = sourceUrl.value
  if (!expected) {
    effectiveUrl.value = ''
    return
  }
  img.src = expected
  img.onload = () => {
    if (sourceUrl.value !== expected) return
    imageFailed.value = false
    effectiveUrl.value = expected
  }
  img.onerror = () => {
    if (sourceUrl.value !== expected) return
    imageFailed.value = true
  }
}

onMounted(checkImage)
watch(sourceUrl, checkImage)
watch(sourceError, error => {
  if (error) imageFailed.value = true
})
watch(() => props.isUnknown, checkImage)
</script>

<template>
  <div
    :style="{ backgroundImage: isUnknown || imageFailed ? undefined : `url(${effectiveUrl})` }"
    :aria-label="`Pet icon ${id}`"
    role="img"
    class="pet-icon"
    :class="{ reverse: reverse }"
  >
    <svg v-if="isUnknown || imageFailed" viewBox="0 0 80 80" aria-hidden="true" class="pet-icon__unknown">
      <path
        d="M40 3 73 21v38L40 77 7 59V21Z"
        fill="var(--battle-panel, #0c1b2a)"
        stroke="var(--battle-line, #365368)"
      />
      <path
        d="M28 27q12-15 24 0t-12 18v8m0 5v4"
        fill="none"
        stroke="var(--battle-muted, #a3bac9)"
        stroke-width="4"
        stroke-linecap="round"
      />
    </svg>
  </div>
</template>

<style scoped>
.pet-icon {
  background-size: contain;
  background-position: center;
  background-repeat: no-repeat;
}

.pet-icon__unknown {
  width: 100%;
  height: 100%;
}

.pet-icon.reverse {
  transform: scaleX(-1);
}
</style>
