<template>
  <div class="climax-effect-container" :class="{ playing: isPlaying }" :style="getContainerStyle()">
    <!-- 动画帧图片 -->
    <div
      v-for="frame in animationFrames"
      :key="`frame-${frame.id}`"
      class="effect-frame"
      :class="{ visible: frame.visible }"
      :style="getFrameStyle(frame)"
    >
      <img
        :src="climaxEffectImages[frame.id]"
        :alt="`Frame ${frame.id}`"
        class="frame-image"
        :style="getImageStyle(frame)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

// 导入所有 climax_effect 图片
import climaxEffect90 from '@/assets/images/climax_effect/90.png'
import climaxEffect91 from '@/assets/images/climax_effect/91.png'
import climaxEffect92 from '@/assets/images/climax_effect/92.png'
import climaxEffect93 from '@/assets/images/climax_effect/93.png'
import climaxEffect94 from '@/assets/images/climax_effect/94.png'
import climaxEffect95 from '@/assets/images/climax_effect/95.png'
import climaxEffect96 from '@/assets/images/climax_effect/96.png'

// 创建图片映射
const climaxEffectImages: Record<number, string> = {
  90: climaxEffect90,
  91: climaxEffect91,
  92: climaxEffect92,
  93: climaxEffect93,
  94: climaxEffect94,
  95: climaxEffect95,
  96: climaxEffect96,
}

// 动画帧接口定义
interface AnimationFrame {
  id: number
  visible: boolean
  offsetX: number // X轴偏移量 (px) - 兼容旧版本
  offsetY: number // Y轴偏移量 (px) - 兼容旧版本
  offsetXPercent?: number // X轴偏移量 (%)
  offsetYPercent?: number // Y轴偏移量 (%)
  scale: number // 缩放比例 (1.0 = 原始大小)
  rotation: number // 旋转角度 (度)
  description: string
}

// Props定义
interface Props {
  autoPlay?: boolean // 是否自动播放
  loop?: boolean // 是否循环播放
  frameDuration?: number // 每帧持续时间(ms)
  onComplete?: () => void // 动画完成回调
  flipHorizontal?: boolean // 是否水平翻转（用于敌方特效）
}

const props = withDefaults(defineProps<Props>(), {
  autoPlay: false,
  loop: false,
  frameDuration: 100,
})

// 响应式数据
const isPlaying = ref(false)
const currentFrame = ref(0)

// 使用调整好的百分比数据
const animationFrames = ref<AnimationFrame[]>([
  {
    id: 90,
    visible: false,
    offsetX: 0,
    offsetY: 0,
    offsetXPercent: 7.808764940239044,
    offsetYPercent: -2.0717131474103585,
    scale: 1,
    rotation: 0,
    description: '第一帧：90出现',
  },
  {
    id: 91,
    visible: false,
    offsetX: 0,
    offsetY: 0,
    offsetXPercent: 7.091633466135457,
    offsetYPercent: -7.968127490039841,
    scale: 1,
    rotation: 0,
    description: '第二帧：91出现',
  },
  {
    id: 92,
    visible: false,
    offsetX: 0,
    offsetY: 0,
    offsetXPercent: -0.1593625498007969,
    offsetYPercent: -0.1593625498007968,
    scale: 0.5,
    rotation: 0,
    description: '第三帧：92出现',
  },
  {
    id: 93,
    visible: false,
    offsetX: 0,
    offsetY: 0,
    offsetXPercent: 3.426294820717132,
    offsetYPercent: -11.235059760956174,
    scale: 1,
    rotation: 0,
    description: '第四帧：93出现',
  },
  {
    id: 94,
    visible: false,
    offsetX: 0,
    offsetY: 0,
    offsetXPercent: -0.2390438247011952,
    offsetYPercent: 0,
    scale: 0.25,
    rotation: 0,
    description: '第五帧：94出现',
  },
  {
    id: 95,
    visible: false,
    offsetX: 0,
    offsetY: 0,
    offsetXPercent: 14.581673306772906,
    offsetYPercent: -14.581673306772906,
    scale: 1,
    rotation: 0,
    description: '第六帧：95出现',
  },
  {
    id: 96,
    visible: false,
    offsetX: 0,
    offsetY: 0,
    offsetXPercent: 0,
    offsetYPercent: 0,
    scale: 1,
    rotation: 0,
    description: '第七帧：96出现',
  },
])

// 九帧动画序列定义
const frameSequence = [
  { frame: 1, show: [90], hide: [], description: '第一帧：90出现' },
  { frame: 2, show: [91], hide: [90], description: '第二帧：91出现，90消失' },
  { frame: 3, show: [92], hide: [], description: '第三帧：92出现' },
  { frame: 4, show: [93], hide: [91], description: '第四帧：93出现，91消失' },
  { frame: 5, show: [94], hide: [92], description: '第五帧：94出现，92消失' },
  { frame: 6, show: [95], hide: [93], description: '第六帧：95出现，93消失' },
  { frame: 7, show: [], hide: [94], description: '第七帧：94消失' },
  { frame: 8, show: [96], hide: [95], description: '第八帧：95消失，96出现' },
  { frame: 9, show: [], hide: [96], description: '第九帧：全部消失' },
]

// 获取容器样式
const getContainerStyle = () => {
  return {
    transform: props.flipHorizontal ? 'scaleX(-1)' : 'none',
  }
}

// 获取帧容器样式
const getFrameStyle = (frame: AnimationFrame) => {
  // 优先使用百分比偏移，如果没有则使用像素偏移转换为百分比
  let offsetXPercent: number
  let offsetYPercent: number

  if (frame.offsetXPercent !== undefined && frame.offsetYPercent !== undefined) {
    // 使用百分比偏移
    offsetXPercent = frame.offsetXPercent
    offsetYPercent = frame.offsetYPercent
  } else {
    // 将像素偏移转换为百分比偏移（兼容旧版本）
    const originalSize = 1255
    offsetXPercent = (frame.offsetX / originalSize) * 100
    offsetYPercent = (frame.offsetY / originalSize) * 100
  }

  return {
    transform: `translate(-50%, -50%) translate(${offsetXPercent}%, ${offsetYPercent}%)`,
  }
}

// 获取图片样式
const getImageStyle = (frame: AnimationFrame) => {
  const transforms = []

  if (frame.scale !== 1.0) {
    transforms.push(`scale(${frame.scale})`)
  }

  if (frame.rotation !== 0) {
    transforms.push(`rotate(${frame.rotation}deg)`)
  }

  return {
    transform: transforms.length > 0 ? transforms.join(' ') : undefined,
  }
}

// 更新帧显示状态
const updateFrameVisibility = (frameData: any) => {
  // 隐藏指定的帧
  if (frameData.hide && frameData.hide.length > 0) {
    frameData.hide.forEach((frameId: number) => {
      const frame = animationFrames.value.find(f => f.id === frameId)
      if (frame) {
        frame.visible = false
      }
    })
  }

  // 显示指定的帧
  if (frameData.show && frameData.show.length > 0) {
    frameData.show.forEach((frameId: number) => {
      const frame = animationFrames.value.find(f => f.id === frameId)
      if (frame) {
        frame.visible = true
      }
    })
  }
}

// 隐藏所有帧
const hideAllFrames = () => {
  animationFrames.value.forEach(frame => {
    frame.visible = false
  })
}

// 播放动画
const playAnimation = async () => {
  if (isPlaying.value) return

  isPlaying.value = true
  currentFrame.value = 0

  // 隐藏所有帧
  hideAllFrames()

  // 执行九帧动画序列
  for (let i = 0; i < frameSequence.length; i++) {
    const frameData = frameSequence[i]
    currentFrame.value = frameData.frame

    // 更新帧显示状态
    updateFrameVisibility(frameData)

    // 等待下一帧
    await new Promise(resolve => setTimeout(resolve, props.frameDuration))
  }

  // 动画结束
  hideAllFrames()
  isPlaying.value = false
  currentFrame.value = 0

  // 调用完成回调
  if (props.onComplete) {
    props.onComplete()
  }

  // 如果需要循环播放
  if (props.loop && !isPlaying.value) {
    setTimeout(() => {
      playAnimation()
    }, 500)
  }
}

// 暴露给父组件的方法
defineExpose({
  play: playAnimation,
  stop: () => {
    isPlaying.value = false
    hideAllFrames()
    currentFrame.value = 0
  },
  isPlaying: () => isPlaying.value,
})

// 自动播放
onMounted(() => {
  if (props.autoPlay) {
    playAnimation()
  }
})
</script>

<style scoped>
.climax-effect-container {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 特效帧样式 */
.effect-frame {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  opacity: 0;
  z-index: 10;
}

.effect-frame.visible {
  opacity: 1;
}

.frame-image {
  display: block;
  filter: drop-shadow(0 0 20px rgba(255, 255, 255, 0.5));
}
</style>
