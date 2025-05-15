<script setup lang="ts">
import 'seer2-pet-animator'
import { ActionState } from 'seer2-pet-animator'
import type {} from 'seer2-pet-animator' //Vue Declare
import { computed, markRaw, onMounted, reactive, ref, useTemplateRef, watchEffect, watch } from 'vue'
import { useElementBounding } from '@vueuse/core'
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

const swfUrl = computed(() => {
  // return `https://seer2.61.com/res/pet/fight/${props.num}.swf`
  return `https://cdn.jsdelivr.net/gh/arcadia-star/seer2-pet-preview@master/public/fight/${props.num}.swf`
})
const { width: containerWidth, height: containerHeidht } = useElementBounding(petSpriteRef)

const scale = computed(() => {
  const baseWidth = 960
  const baseHeight = 560

  const scaleX = containerWidth.value / baseWidth
  const scaleY = containerHeidht.value / baseHeight
  return Math.min(scaleX, scaleY)
})

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

watchEffect(async () => {
  // 确保 petRenderRef.value 存在，并且 currentReadyResolve 对应的是当前的 Promise
  if (props.num && petRenderRef.value && currentReadyResolve) {
    console.debug(`PetSprite: watchEffect triggered for num ${props.num}. Fetching available states.`)
    try {
      const states = (await petRenderRef.value.getAvailableStates()) as ActionState[]
      availableState.value = states
      console.debug(`PetSprite: availableStates updated for num ${props.num}:`, states)
      inited.value = true
      currentReadyResolve() // Resolve 当前的 Promise
      currentReadyResolve = undefined // 清除 resolver，防止意外调用
      console.debug(`PetSprite: ready promise resolved for num ${props.num}.`)
    } catch (error) {
      console.error(`PetSprite: Error fetching available states for num ${props.num}:`, error)
      // 考虑是否需要 reject Promise 或其他错误处理
    }
  }
})

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
      :key="num"
      v-show="inited"
      class="overflow-visible pet-render"
      ref="pet-render"
      :url="swfUrl"
      :reverse="reverse"
      :scaleX="scale"
      :scaleY="scale"
      salign="TL"
      :offsetX="300"
      @hit="handleHitEvent"
      @animationComplete="handleAnimationComplete"
    />
  </div>
</template>
