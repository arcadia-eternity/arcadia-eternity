<script setup lang="ts">
import { nextTick, ref, useId, watch } from 'vue'
import { onClickOutside, onKeyStroke } from '@vueuse/core'
import { ChevronDownIcon, XMarkIcon } from '@heroicons/vue/20/solid'
import {
  estimatePreloadSeconds,
  isMediaPreloading,
  mediaPreloadBatches,
  type MediaPreloadBatch,
} from '@/services/mediaPreloadProgress'

const root = ref<HTMLElement>()
const trigger = ref<HTMLButtonElement>()
const panelId = useId()
const open = ref(false)
const visible = ref(false)
const now = ref(0)
watch(
  isMediaPreloading,
  (active, _, onCleanup) => {
    if (!active) {
      visible.value = false
      return
    }
    // A preload served immediately from memory should not flash in the header.
    const timer = setTimeout(() => (visible.value = true), 200)
    onCleanup(() => clearTimeout(timer))
  },
  { immediate: true },
)
watch([open, isMediaPreloading], ([show, active], _, onCleanup) => {
  if (!show || !active) return
  now.value = performance.now()
  const timer = window.setInterval(() => (now.value = performance.now()), 1000)
  onCleanup(() => window.clearInterval(timer))
})

function timing(batch: MediaPreloadBatch) {
  if (batch.state === 'cancelled') return '已取消'
  if (batch.state === 'finished') return batch.failed ? '已结束' : '已完成'
  const seconds = estimatePreloadSeconds(batch, now.value)
  if (seconds === undefined) return '正在估算剩余时间…'
  if (seconds < 60) return `预计还需约 ${Math.ceil(seconds / 5) * 5} 秒`
  return `预计还需约 ${Math.ceil(seconds / 60)} 分钟`
}

async function close() {
  const returnTo = visible.value
    ? trigger.value
    : root.value?.closest('header')?.querySelector('button:not([aria-controls])')
  open.value = false
  await nextTick()
  if (returnTo instanceof HTMLElement) returnTo.focus()
}
onClickOutside(root, () => (open.value = false))
onKeyStroke('Escape', event => {
  if (open.value) {
    event.preventDefault()
    void close()
  }
})
</script>

<template>
  <div ref="root" class="absolute left-0 top-full text-left">
    <button
      v-if="visible || open"
      ref="trigger"
      type="button"
      :aria-controls="panelId"
      :aria-expanded="open"
      aria-label="查看预载详情"
      class="relative flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-sm text-[11px] leading-3 text-sky-200 after:absolute after:-inset-x-1 after:-inset-y-1.5 hover:text-white focus-visible:outline-2"
      @click="open = !open"
    >
      <span
        v-if="isMediaPreloading"
        aria-hidden="true"
        class="size-2.5 rounded-full border-2 border-sky-300/35 border-t-sky-200 motion-safe:animate-spin"
      ></span>
      <span role="status">{{ isMediaPreloading ? '正在预载' : '预载详情' }}</span>
      <ChevronDownIcon aria-hidden="true" class="size-3" :class="{ 'rotate-180': open }" />
    </button>

    <section
      v-if="open"
      :id="panelId"
      aria-label="预载详情"
      class="absolute left-0 top-full z-10 mt-2 max-h-[65dvh] w-80 max-w-[calc(100vw-5rem)] overflow-y-auto rounded-xl border border-slate-600 bg-slate-900 text-sm font-normal leading-5 text-slate-100 shadow-xl"
    >
      <div class="flex items-center justify-between border-b border-slate-700 px-4 py-2">
        <h2 class="text-sm font-semibold">预载详情</h2>
        <button
          type="button"
          aria-label="关闭预载详情"
          class="cursor-pointer rounded p-1 text-slate-300 hover:bg-slate-700"
          @click="close"
        >
          <XMarkIcon aria-hidden="true" class="size-4" />
        </button>
      </div>
      <ul class="divide-y divide-slate-700/70">
        <li v-for="batch in mediaPreloadBatches" :key="batch.id" class="space-y-1.5 px-4 py-3">
          <div class="flex items-baseline justify-between gap-2">
            <span class="font-medium">{{ batch.label }}</span>
            <span class="whitespace-nowrap text-xs tabular-nums text-slate-300"
              >已处理 {{ batch.completed }} / {{ batch.total }}</span
            >
          </div>
          <div
            role="progressbar"
            :aria-label="batch.label"
            :aria-valuenow="batch.completed"
            :aria-valuemax="batch.total"
            aria-valuemin="0"
            class="h-1 overflow-hidden rounded-full bg-slate-700"
          >
            <div
              class="h-full rounded-full"
              :class="batch.state === 'cancelled' ? 'bg-slate-400' : 'bg-sky-300'"
              :style="{ width: (100 * batch.completed) / batch.total + '%' }"
            ></div>
          </div>
          <div class="flex flex-wrap items-baseline justify-between gap-x-2 text-xs text-slate-300">
            <span>{{ timing(batch) }}</span>
            <span v-if="batch.failed" class="text-amber-300">失败 {{ batch.failed }} 项</span>
          </div>
          <ul v-if="batch.loading.size" aria-label="正在处理的资源" class="space-y-0.5 pt-0.5 text-xs text-slate-400">
            <li v-for="[index, name] in batch.loading" :key="index" class="truncate" :title="name">{{ name }}</li>
          </ul>
        </li>
      </ul>
    </section>
  </div>
</template>
