<script setup lang="ts">
import { computed, ref } from 'vue'
import ContentDescription from '@/components/ContentDescription'
import Tooltip from './Tooltip.vue'
import ResourceImage from '../ResourceImage.vue'
import type { MarkMessage } from '@arcadia-eternity/const'
import { useResourceStore } from '@/stores/resource'
import { Z_INDEX } from '@/constants/zIndex'
import i18next from 'i18next'
import { useGameDataStore } from '@/stores/gameData'
import { resolveMarkIconUrl } from '@/utils/resourceResolver'

const resourceStore = useResourceStore()
const dataStore = useGameDataStore()

const props = withDefaults(
  defineProps<{
    mark: MarkMessage
  }>(),
  {},
)

const rootEl = ref<HTMLElement | null>(null)
const showTooltip = ref(false)
const stackText = computed(() => `${props.mark.stack}`)
const markData = computed(() => dataStore.getMark(props.mark.baseId))
const image = computed(() => {
  return resolveMarkIconUrl(markData.value, resourceStore.getMarkImage)
})
const name = computed(() =>
  i18next.t(`${props.mark.baseId}.name`, {
    ns: ['mark', 'mark_ability', 'mark_emblem', 'mark_global'],
  }),
)
const description = computed(() =>
  i18next.t(`${props.mark.baseId}.description`, {
    mark: props.mark,
    ns: ['mark', 'mark_ability', 'mark_emblem', 'mark_global'],
  }),
)
const duration = computed(() => props.mark.duration ?? -1)
</script>

<template>
  <div ref="rootEl" class="relative inline-block overflow-visible group" data-tooltip-parent>
    <Tooltip
      interactive
      portal
      v-model:show="showTooltip"
      position="bottom"
      v-if="rootEl"
      :trigger="showTooltip ? 'click' : 'hover'"
    >
      <template #trigger>
        <button
          type="button"
          :aria-label="`${name}印记详情`"
          :aria-expanded="showTooltip"
          @click="showTooltip = !showTooltip"
          class="battle-mark__trigger relative transition-transform duration-200 ease-in-out hover:-translate-y-0.5"
          :class="`z-[${Z_INDEX.MARK}]`"
        >
          <ResourceImage
            :src="image"
            :uncached="!!markData?.presentation?.icon"
            class="battle-mark__icon object-contain transition-opacity duration-200 ease-in-out pointer-events-none"
            :alt="name"
            :class="{ 'opacity-50': !mark.config.persistent && duration == 1 }"
          />
          <div v-if="mark.config.stackable && (mark.config.maxStacks ?? 1) > 1" class="battle-mark__stack">
            {{ stackText }}
          </div>
        </button>
      </template>

      <h3 class="text-lg font-bold mb-2">{{ name }}</h3>
      <ContentDescription
        namespace="mark"
        :content-id="mark.baseId"
        :fallback="description"
        :context="{ mark }"
        class="text-sm text-gray-200 leading-relaxed mb-3 prose prose-invert max-w-none"
      />
      <div class="text-xs text-gray-400 mt-2" v-if="!mark.config.persistent">剩余回合: {{ duration }}</div>
    </Tooltip>
  </div>
</template>

<style scoped>
.battle-mark__trigger {
  display: block;
  width: 36px;
  height: 36px;
  padding: 0;
  cursor: pointer;
}
.battle-mark__trigger:focus-visible {
  outline: 2px solid var(--battle-cyan);
  outline-offset: 2px;
}
.battle-mark__icon {
  width: 100%;
  height: 100%;
}
.battle-mark__stack {
  position: absolute;
  bottom: -2px;
  right: -3px;
  min-width: 16px;
  padding: 1px 3px;
  border-radius: 6px;
  background: #07111db3;
  color: #fff;
  font-size: 14px;
  line-height: 16px;
  text-align: center;
  text-shadow: 0 1px 2px #000;
}
</style>
