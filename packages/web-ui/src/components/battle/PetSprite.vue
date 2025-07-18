<script setup lang="ts">
import 'seer2-pet-animator'
import { ActionState } from 'seer2-pet-animator'
import type {} from 'seer2-pet-animator' //Vue Declare
import { ref, useTemplateRef, watchEffect, watch, nextTick, computed } from 'vue'
import { petResourceCache } from '@/services/petResourceCache'
import { asyncComputed } from '@vueuse/core'

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

const petSpriteRef = useTemplateRef('petSpriteRef')
const petRenderRef = useTemplateRef('pet-render')
const inited = ref(false)
const forceHttps = computed(() => window.location.protocol === 'https:')

// 使用 asyncComputed 来异步获取 URL，避免初始化时的空值问题
const swfUrl = asyncComputed(
  async () => {
    if (!props.num) return ''
    const url = await petResourceCache.getPetSwfUrl(props.num)
    console.log(`PetSprite(${props.num}): 获取到 URL:`, url)
    return url
  },
  '', // 默认值
)

const availableState = ref<ActionState[]>([])

// 修改 ready 和 readyResolve 的定义
const ready = ref<Promise<void>>()
let currentReadyResolve: (() => void) | undefined = undefined

function resetReady() {
  inited.value = false // 重置 inited 状态
  availableState.value = [] // 清空旧的 availableState
  ready.value = new Promise<void>(resolve => {
    currentReadyResolve = resolve
  })
}

// 初始化时调用
resetReady()

// 监听 props.num 的变化
watch(
  () => props.num,
  () => {
    console.debug(`PetSprite: num changed to ${props.num}, resetting ready promise.`)
    resetReady()
  },
  { immediate: false },
)

watchEffect(
  async () => {
    // 确保 petRenderRef.value 存在，并且 currentReadyResolve 对应的是当前的 Promise
    if (props.num && petRenderRef.value && currentReadyResolve !== undefined && !inited.value) {
      console.debug(`PetSprite: watchEffect triggered for num ${props.num}. Fetching available states.`)
      try {
        // 重试机制：确保pet-render组件完全准备好
        let states: ActionState[] | undefined
        let retryCount = 0
        const maxRetries = 5

        while ((!states || states.length === 0) && retryCount < maxRetries) {
          await nextTick()
          await petRenderRef.value.updateComplete
          states = (await petRenderRef.value.getAvailableStates()) as ActionState[]
          if (!states || states.length === 0) {
            console.debug(
              `PetSprite: getAvailableStates returned undefined for num ${props.num}, retry ${retryCount + 1}/${maxRetries}`,
            )
            // 等待一小段时间让pet-render完全加载
            await new Promise(resolve => setTimeout(resolve, 100))
            retryCount++
          }
        }

        if (states) {
          availableState.value = states
          console.debug(`PetSprite: availableStates updated for num ${props.num}:`, states)

          // 安全地调用 resolve 函数
          const resolveFunction = currentReadyResolve
          currentReadyResolve = undefined // 先清除，防止重复调用
          if (typeof resolveFunction === 'function') {
            resolveFunction() // Resolve 当前的 Promise
            console.debug(`PetSprite: ready promise resolved for num ${props.num}.`)
          }
        } else {
          console.error(`PetSprite: Failed to get available states for num ${props.num} after ${maxRetries} retries`)
          // 即使失败也要清理 resolver
          const resolveFunction = currentReadyResolve
          currentReadyResolve = undefined
          if (typeof resolveFunction === 'function') {
            resolveFunction() // 即使出错也要 resolve，避免 Promise 永远 pending
          }
        }
      } catch (error) {
        console.error(`PetSprite: Error fetching available states for num ${props.num}:`, error)
        // 在错误情况下也要清理 resolver
        const resolveFunction = currentReadyResolve
        currentReadyResolve = undefined
        if (typeof resolveFunction === 'function') {
          resolveFunction() // 即使出错也要 resolve，避免 Promise 永远 pending
        }
      }
    }
  },
  {
    flush: 'post',
  },
)

const setState = async (state: ActionState) => {
  await petRenderRef.value?.setState(state)
}

const getState = async () => {
  return petRenderRef.value?.getState()
}

const handleHitEvent = (event: { detail: any }) => {
  console.debug('hit', event.detail)
  emit('hit', event.detail)
}

const handleAnimationComplete = (event: { detail: any }) => {
  console.debug('播放完毕:', event.detail)
  emit('animateComplete', event.detail)
}

const emit = defineEmits<{
  hit: [detail: any]
  animateComplete: [detail: any]
}>()
defineExpose({
  setState,
  getState,
  availableState,
  ready,
})
</script>
<template>
  <div ref="petSpriteRef" class="w-full h-full overflow-visible">
    <pet-render
      v-if="swfUrl && props.num"
      class="overflow-visible pet-render"
      ref="pet-render"
      :url="swfUrl"
      :reverse="reverse"
      salign="TL"
      :offsetX="275"
      :offsetY="160"
      :scaleX="1.1"
      :scaleY="1.1"
      @hit="handleHitEvent"
      @animationComplete="handleAnimationComplete"
      :forceHttps="forceHttps"
    />
  </div>
</template>
