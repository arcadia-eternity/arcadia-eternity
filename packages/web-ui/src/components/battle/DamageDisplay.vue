<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

// 定义属性
interface Props {
  value: number
  type?: string
}

const props = withDefaults(defineProps<Props>(), {
  type: '',
})

// 属性验证
if (props.value <= 0) {
  console.warn('DamageDisplay: value must be greater than 0')
}

// 计算背景图片路径
const backgroundImage = computed(() => {
  const baseUrl = 'https://cdn.jsdelivr.net/gh/arcadia-star/seer2-resource@main/png/damage/'
  if (props.type === 'blue') {
    return `${baseUrl}damage_blue.png`
  } else if (props.type === 'red') {
    return `${baseUrl}damage_red.png`
  } else {
    return `${baseUrl}damage.png`
  }
})

// 将数字转换为数字数组
const digits = computed(() => {
  return props.value.toString().split('')
})

// 动态计算长数字的缩放比例 - 增加基础比例为2倍
const contentStyle = computed(() => {
  const length = digits.value.length
  let scale = 1

  if (length >= 6) scale = 0.7
  else if (length >= 5) scale = 0.75
  else if (length >= 4) scale = 0.8

  return {
    transform: `scale(${scale})`,
    transformOrigin: 'center center',
    display: 'inline-block',
    width: 'auto',
  }
})

// 预加载图片缓存状态
const imagesLoaded = ref(false)

// 预加载所有数字图片和背景图片
const preloadImages = () => {
  const promises = []
  const baseUrl = 'https://cdn.jsdelivr.net/gh/arcadia-star/seer2-resource@main/png/'

  // 预加载背景图片
  const backgroundTypes = ['damage.png', 'damage_blue.png', 'damage_red.png']
  backgroundTypes.forEach(bg => {
    const img = new Image()
    const promise = new Promise(resolve => {
      img.onload = resolve
      img.onerror = resolve
    })
    img.src = `${baseUrl}damage/${bg}`
    promises.push(promise)
  })

  // 预加载减号图片
  const minusImg = new Image()
  const minusPromise = new Promise(resolve => {
    minusImg.onload = resolve
    minusImg.onerror = resolve
  })
  minusImg.src = `${baseUrl}damageNumber/minus.png`
  promises.push(minusPromise)

  // 预加载数字图片 (0-9)
  for (let i = 0; i <= 9; i++) {
    const img = new Image()
    const promise = new Promise(resolve => {
      img.onload = resolve
      img.onerror = resolve
    })
    img.src = `${baseUrl}damageNumber/${i}.png`
    promises.push(promise)
  }

  // 当所有图片加载完成时更新状态
  Promise.all(promises).then(() => {
    imagesLoaded.value = true
  })
}

// 在组件挂载时预加载所有图片
onMounted(() => {
  preloadImages()
})
</script>

<template>
  <div class="relative inline-block">
    <!-- 背景图片 - 高度从h-20(5rem)增加到h-40(10rem) -->
    <img :src="backgroundImage" alt="damage background" class="h-40 w-auto" />

    <!-- 外层容器 - 覆盖整个背景并居中内容 -->
    <div class="absolute inset-0 flex items-center justify-center overflow-visible">
      <!-- 内容容器 - 应用动态缩放 -->
      <div :style="contentStyle" class="inline-block">
        <!-- 将所有内容置于单一容器内，使用行内显示模式确保尺寸由内容决定 -->
        <div class="flex items-center justify-center whitespace-nowrap">
          <img
            src="https://cdn.jsdelivr.net/gh/arcadia-star/seer2-resource@main/png/damageNumber/minus.png"
            alt="minus"
            class="h-10 object-contain"
          />

          <!-- 数字图片 - 高度从h-9增加到h-18，负边距从-ml-1增加到-ml-2 -->
          <img
            v-for="(digit, index) in digits"
            :key="index"
            :src="`https://cdn.jsdelivr.net/gh/arcadia-star/seer2-resource@main/png/damageNumber/${digit}.png`"
            :alt="`digit ${digit}`"
            class="h-16 object-contain"
            :class="index > 0 ? '-ml-2' : ''"
          />
        </div>
      </div>
    </div>
  </div>
</template>
