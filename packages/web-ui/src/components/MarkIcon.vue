<script setup lang="ts">
import { computed } from 'vue'
import type { MarkSchemaType } from '@arcadia-eternity/schema'
import { useGameDataStore } from '@/stores/gameData'
import { useResourceStore } from '@/stores/resource'
import { resolveMarkIconUrl } from '@/utils/resourceResolver'

const props = withDefaults(
  defineProps<{
    markId?: string
    mark?: Partial<MarkSchemaType>
    size?: number
  }>(),
  {
    markId: '',
    mark: undefined,
    size: 24,
  },
)

const gameDataStore = useGameDataStore()
const resourceStore = useResourceStore()

const normalizedMarkId = computed(() => String(props.markId ?? '').trim())

const resolvedMark = computed<Partial<MarkSchemaType> | undefined>(() => {
  const markFromStore = normalizedMarkId.value
    ? gameDataStore.marks.byId[normalizedMarkId.value]
    : undefined

  if (props.mark && typeof props.mark === 'object') {
    return {
      ...(markFromStore ?? {}),
      ...props.mark,
      id: String(props.mark.id ?? normalizedMarkId.value).trim(),
    }
  }

  if (markFromStore) return markFromStore
  if (normalizedMarkId.value) return { id: normalizedMarkId.value }
  return undefined
})

const imageUrl = computed(() => {
  return resolveMarkIconUrl(resolvedMark.value, resourceStore.getMarkImage)
})

const iconStyle = computed(() => {
  const size = Number.isFinite(props.size) && (props.size ?? 0) > 0 ? Number(props.size) : 24
  return {
    width: `${size}px`,
    height: `${size}px`,
    minHeight: `${size}px`,
  }
})
</script>

<template>
  <img :src="imageUrl" alt="" class="mark-icon" :style="iconStyle" />
</template>

<style scoped>
.mark-icon {
  display: inline-block;
  object-fit: contain;
}
</style>
