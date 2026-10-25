<script setup lang="ts">
import { officialAssetUrl } from '@/utils/officialAssetUrl'
import unknownPet from '@/assets/images/unknown-pet.svg'
import { computed } from 'vue'
const props = withDefaults(
  defineProps<{
    num: number
    reverse?: boolean
  }>(),
  {
    num: 999,
    reverse: false,
  },
)

const petUrl = computed(() => officialAssetUrl(`https://seer2-resource.yuuinih.com/png/pet/${props.num}.png`))
</script>

<template>
  <img
    :src="petUrl"
    :alt="`Pet ${num}`"
    class="object-contain"
    :class="{ reverse: reverse }"
    @error="e => ((e.target as HTMLImageElement).src = unknownPet)"
  />
</template>

<style scoped>
.reverse {
  transform: scaleX(-1);
}
</style>
