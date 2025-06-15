<template>
  <div class="effect-demo-container">
    <div class="demo-header">
      <h1>九帧特效演示</h1>
      <button @click="startAnimation" :disabled="isAnimating" class="start-btn">
        {{ isAnimating ? '动画进行中...' : '开始动画' }}
      </button>
    </div>

    <!-- 容器尺寸控制 -->
    <div class="container-controls">
      <label>容器尺寸:</label>
      <input type="range" v-model.number="containerSize" min="200" max="1255" step="5" />
      <span>{{ containerSize }}px</span>
      <button @click="resetContainerSize" class="reset-size-btn">重置</button>
    </div>

    <!-- 特效容器 -->
    <div
      class="effect-container"
      ref="effectContainer"
      :style="{
        width: containerSize + 'px',
        height: containerSize + 'px',
        border: '2px solid rgba(255, 255, 255, 0.3)',
      }"
    >
      <!-- 中心参考点 -->
      <div class="center-reference" :class="{ visible: showCenterReference }">
        <div class="center-cross">
          <div class="horizontal-line"></div>
          <div class="vertical-line"></div>
        </div>
        <div class="center-dot"></div>
        <div class="reference-label">中心参考点</div>
      </div>

      <!-- 动画帧图片 -->
      <div
        v-for="frame in animationFrames"
        :key="`frame-${frame.id}`"
        class="effect-frame"
        :class="{
          visible: frame.visible,
          draggable: isDraggingEnabled && frame.visible,
          selected: selectedFrameId === frame.id,
        }"
        :style="getFrameStyle(frame)"
        @mousedown="startDrag($event, frame)"
        @wheel="handleWheel($event, frame)"
        @click="selectFrame(frame)"
      >
        <img
          :src="climaxEffectImages[frame.id]"
          :alt="`Frame ${frame.id}`"
          class="frame-image"
          :style="getImageStyle(frame)"
          draggable="false"
        />
        <!-- 选中框 -->
        <div v-if="selectedFrameId === frame.id" class="selection-border"></div>
        <!-- 拖动提示 -->
        <div v-if="isDraggingEnabled && frame.visible" class="drag-hint">拖动调整位置</div>
      </div>
    </div>

    <!-- 控制面板 -->
    <div class="control-panel">
      <div class="animation-info">
        <p>当前帧: {{ currentFrame }}/9</p>
        <p>动画状态: {{ isAnimating ? '进行中' : '已停止' }}</p>
        <p>可见图片: {{ visibleFrames.join(', ') }}</p>
        <p v-if="selectedFrameId">选中图片: {{ selectedFrameId }}.png</p>
      </div>

      <div class="interaction-controls">
        <button
          @click="isDraggingEnabled = !isDraggingEnabled"
          class="toggle-drag-btn"
          :class="{ active: isDraggingEnabled }"
        >
          {{ isDraggingEnabled ? '禁用拖动' : '启用拖动' }}
        </button>

        <div class="help-text">
          <p><strong>操作说明:</strong></p>
          <p>• 点击图片选中</p>
          <p>• 拖动图片调整位置</p>
          <p>• 滚轮调整Y轴位置</p>
          <p>• Shift+滚轮调整X轴位置</p>
        </div>
      </div>
    </div>

    <!-- 调整面板 -->
    <div class="adjustment-panel" :class="{ collapsed: panelCollapsed }">
      <div class="panel-header">
        <h3>图片参数调整</h3>
        <button @click="panelCollapsed = !panelCollapsed" class="collapse-btn">
          {{ panelCollapsed ? '展开' : '收起' }}
        </button>
        <button @click="exportConfig" class="export-btn">导出配置</button>
      </div>

      <div class="panel-content" v-if="!panelCollapsed">
        <!-- 帧控制器 -->
        <div class="frame-controller">
          <h4>帧控制器</h4>
          <div class="frame-navigator">
            <button
              v-for="i in 9"
              :key="`frame-nav-${i}`"
              @click="goToFrame(i)"
              class="frame-nav-btn"
              :class="{ active: currentEditFrame === i }"
            >
              {{ i }}
            </button>
          </div>
          <div class="frame-info">
            <p>当前编辑帧: {{ currentEditFrame }}/9</p>
            <p>{{ frameSequence[currentEditFrame - 1]?.description || '' }}</p>
          </div>
          <div class="frame-actions">
            <button @click="prevFrame" :disabled="currentEditFrame <= 1" class="nav-btn">上一帧</button>
            <button @click="nextFrame" :disabled="currentEditFrame >= 9" class="nav-btn">下一帧</button>
            <button @click="playCurrentFrame" class="play-btn">播放当前帧</button>
            <button @click="toggleCenterReference" class="reference-btn" :class="{ active: showCenterReference }">
              {{ showCenterReference ? '隐藏参考' : '显示参考' }}
            </button>
          </div>
        </div>
        <!-- 当前帧相关图片控制 -->
        <div class="current-frame-controls">
          <h4>第{{ currentEditFrame }}帧 - 相关图片</h4>
          <div class="frame-controls" v-for="frame in getCurrentFrameImages()" :key="`control-${frame.id}`">
            <div class="frame-header">
              <h4>图片 {{ frame.id }}.png</h4>
              <button @click="previewFrame(frame)" class="preview-btn">预览</button>
            </div>

            <div class="control-grid">
              <div class="control-item">
                <label>X偏移 (%):</label>
                <input type="number" v-model.number="frame.offsetXPercent" @input="updatePreview" step="0.1" />
              </div>

              <div class="control-item">
                <label>Y偏移 (%):</label>
                <input type="number" v-model.number="frame.offsetYPercent" @input="updatePreview" step="0.1" />
              </div>

              <div class="control-item">
                <label>缩放:</label>
                <input type="number" v-model.number="frame.scale" @input="updatePreview" step="0.1" min="0.1" max="3" />
              </div>

              <div class="control-item">
                <label>旋转 (度):</label>
                <input
                  type="number"
                  v-model.number="frame.rotation"
                  @input="updatePreview"
                  step="1"
                  min="-360"
                  max="360"
                />
              </div>
            </div>
          </div>
        </div>

        <div class="panel-actions">
          <button @click="resetAllParameters" class="reset-btn">重置参数</button>
          <button @click="resetAllFrames" class="reset-all-btn">重置所有</button>
          <button @click="hideAllFrames" class="hide-btn">隐藏所有</button>
        </div>
      </div>
    </div>

    <!-- 导出结果弹窗 -->
    <div class="export-modal" v-if="showExportModal" @click="closeExportModal">
      <div class="export-content" @click.stop>
        <h3>配置导出结果</h3>
        <textarea v-model="exportedConfig" readonly class="export-textarea" @click="selectAllText"></textarea>
        <div class="export-actions">
          <button @click="copyToClipboard" class="copy-btn">复制到剪贴板</button>
          <button @click="closeExportModal" class="close-btn">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

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
  description: string
  // 位置和大小配置
  offsetX?: number // X轴偏移量 (px) - 兼容旧版本
  offsetY?: number // Y轴偏移量 (px) - 兼容旧版本
  offsetXPercent?: number // X轴偏移量 (%)
  offsetYPercent?: number // Y轴偏移量 (%)
  scale?: number // 缩放比例 (1.0 = 原始大小)
  rotation?: number // 旋转角度 (度)
}

// 响应式数据
const effectContainer = ref<HTMLElement>()
const isAnimating = ref(false)
const currentFrame = ref(0)

// 调整面板相关
const panelCollapsed = ref(false)
const showExportModal = ref(false)
const exportedConfig = ref('')

// 帧控制器相关
const currentEditFrame = ref(1) // 当前编辑的帧

// 中心参考点
const showCenterReference = ref(true) // 是否显示中心参考点

// 容器尺寸控制
const containerSize = ref(1255) // 默认1255px

// 拖动和交互控制
const isDraggingEnabled = ref(true) // 是否启用拖动
const selectedFrameId = ref<number | null>(null) // 当前选中的帧ID
const isDragging = ref(false) // 是否正在拖动
const dragStartPos = ref({ x: 0, y: 0 }) // 拖动开始位置
const dragStartOffset = ref({ x: 0, y: 0 }) // 拖动开始时的偏移

// 动画帧数组 - 对应90.png到96.png，可以微调每个图片的位置和大小
const animationFrames = ref<AnimationFrame[]>([
  {
    id: 90,
    visible: false,
    description: '第一帧：90出现',
    offsetX: 0, // X轴偏移量，可以调整
    offsetY: 0, // Y轴偏移量，可以调整
    offsetXPercent: 0, // X轴偏移量 (%)
    offsetYPercent: 0, // Y轴偏移量 (%)
    scale: 1.0, // 缩放比例，1.0 = 原始大小
    rotation: 0, // 旋转角度
  },
  {
    id: 91,
    visible: false,
    description: '第二帧：91出现',
    offsetX: 0,
    offsetY: 0,
    offsetXPercent: 0,
    offsetYPercent: 0,
    scale: 1.0,
    rotation: 0,
  },
  {
    id: 92,
    visible: false,
    description: '第三帧：92出现',
    offsetX: 0,
    offsetY: 0,
    offsetXPercent: 0,
    offsetYPercent: 0,
    scale: 1.0,
    rotation: 0,
  },
  {
    id: 93,
    visible: false,
    description: '第四帧：93出现',
    offsetX: 0,
    offsetY: 0,
    offsetXPercent: 0,
    offsetYPercent: 0,
    scale: 1.0,
    rotation: 0,
  },
  {
    id: 94,
    visible: false,
    description: '第五帧：94出现',
    offsetX: 0,
    offsetY: 0,
    offsetXPercent: 0,
    offsetYPercent: 0,
    scale: 1.0,
    rotation: 0,
  },
  {
    id: 95,
    visible: false,
    description: '第六帧：95出现',
    offsetX: 0,
    offsetY: 0,
    offsetXPercent: 0,
    offsetYPercent: 0,
    scale: 1.0,
    rotation: 0,
  },
  {
    id: 96,
    visible: false,
    description: '第七帧：96出现',
    offsetX: 0,
    offsetY: 0,
    offsetXPercent: 0,
    offsetYPercent: 0,
    scale: 1.0,
    rotation: 0,
  },
])

// 计算当前可见的帧
const visibleFrames = computed(() => {
  return animationFrames.value.filter(frame => frame.visible).map(frame => frame.id)
})

// 获取帧容器样式
const getFrameStyle = (frame: AnimationFrame) => {
  // 优先使用百分比偏移，如果没有则使用像素偏移
  const offsetX = frame.offsetXPercent !== undefined ? `${frame.offsetXPercent}%` : `${frame.offsetX || 0}px`
  const offsetY = frame.offsetYPercent !== undefined ? `${frame.offsetYPercent}%` : `${frame.offsetY || 0}px`

  return {
    transform: `translate(-50%, -50%) translate(${offsetX}, ${offsetY})`,
  }
}

// 获取图片样式
const getImageStyle = (frame: AnimationFrame) => {
  const transforms = []

  if (frame.scale && frame.scale !== 1.0) {
    transforms.push(`scale(${frame.scale})`)
  }

  if (frame.rotation && frame.rotation !== 0) {
    transforms.push(`rotate(${frame.rotation}deg)`)
  }

  return {
    transform: transforms.length > 0 ? transforms.join(' ') : undefined,
  }
}

// 九帧动画序列定义 - 根据您的描述
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

// 开始九帧动画
const startAnimation = async () => {
  if (isAnimating.value) return

  isAnimating.value = true
  currentFrame.value = 0

  // 只隐藏所有帧，不重置参数
  hideAllFrames()

  // 执行九帧动画序列
  for (let i = 0; i < frameSequence.length; i++) {
    const frameData = frameSequence[i]
    currentFrame.value = frameData.frame

    // 更新帧显示状态
    updateFrameVisibility(frameData)

    // 等待下一帧 - 固定时间间隔
    const frameDuration = 600 // 每帧600ms，让用户能清楚看到变化
    await new Promise(resolve => setTimeout(resolve, frameDuration))
  }

  // 动画结束，只隐藏所有帧，保留调整的参数
  setTimeout(() => {
    hideAllFrames()
    isAnimating.value = false
    currentFrame.value = 0
  }, 500)
}

// 调整面板相关函数
const updatePreview = () => {
  // 实时更新预览，这里可以添加防抖逻辑
}

const previewFrame = (frame: AnimationFrame) => {
  // 隐藏所有帧
  hideAllFrames()
  // 显示选中的帧
  frame.visible = true
}

const hideAllFrames = () => {
  animationFrames.value.forEach(frame => {
    frame.visible = false
  })
}

const resetAllFrames = () => {
  animationFrames.value.forEach(frame => {
    frame.visible = false
    frame.offsetX = 0
    frame.offsetY = 0
    frame.offsetXPercent = 0
    frame.offsetYPercent = 0
    frame.scale = 1.0
    frame.rotation = 0
  })
}

// 只重置参数，不影响可见性
const resetAllParameters = () => {
  animationFrames.value.forEach(frame => {
    frame.offsetX = 0
    frame.offsetY = 0
    frame.offsetXPercent = 0
    frame.offsetYPercent = 0
    frame.scale = 1.0
    frame.rotation = 0
  })
}

// 重置容器尺寸
const resetContainerSize = () => {
  containerSize.value = 1255
}

const exportConfig = () => {
  const config = animationFrames.value.map(frame => ({
    id: frame.id,
    offsetX: frame.offsetX || 0,
    offsetY: frame.offsetY || 0,
    offsetXPercent: frame.offsetXPercent || 0,
    offsetYPercent: frame.offsetYPercent || 0,
    scale: frame.scale || 1.0,
    rotation: frame.rotation || 0,
    description: frame.description,
  }))

  exportedConfig.value = JSON.stringify(config, null, 2)
  showExportModal.value = true
}

const closeExportModal = () => {
  showExportModal.value = false
}

const selectAllText = (event: Event) => {
  const textarea = event.target as HTMLTextAreaElement
  textarea.select()
}

const copyToClipboard = async () => {
  try {
    await navigator.clipboard.writeText(exportedConfig.value)
    alert('配置已复制到剪贴板！')
  } catch (err) {
    console.error('复制失败:', err)
    alert('复制失败，请手动选择文本复制')
  }
}

// 帧控制器相关函数
const goToFrame = (frameNumber: number) => {
  currentEditFrame.value = frameNumber
  showCurrentFrameState()
}

const prevFrame = () => {
  if (currentEditFrame.value > 1) {
    currentEditFrame.value--
    showCurrentFrameState()
  }
}

const nextFrame = () => {
  if (currentEditFrame.value < 9) {
    currentEditFrame.value++
    showCurrentFrameState()
  }
}

const playCurrentFrame = () => {
  // 显示当前帧应该显示的图片
  showCurrentFrameState()
}

const showCurrentFrameState = () => {
  // 根据当前编辑帧显示对应的图片状态
  const frameData = frameSequence[currentEditFrame.value - 1]
  if (frameData) {
    // 先隐藏所有帧
    hideAllFrames()

    // 显示当前帧应该显示的图片
    if (frameData.show && frameData.show.length > 0) {
      frameData.show.forEach((frameId: number) => {
        const frame = animationFrames.value.find(f => f.id === frameId)
        if (frame) {
          frame.visible = true
        }
      })
    }
  }
}

// 获取当前帧相关的图片
const getCurrentFrameImages = () => {
  const frameData = frameSequence[currentEditFrame.value - 1]
  if (!frameData) return []

  // 获取当前帧显示的图片ID
  const showIds = frameData.show || []
  const hideIds = frameData.hide || []
  const allIds = [...new Set([...showIds, ...hideIds])]

  // 返回相关的图片对象
  return animationFrames.value.filter(frame => allIds.includes(frame.id))
}

// 切换中心参考点显示
const toggleCenterReference = () => {
  showCenterReference.value = !showCenterReference.value
}

// 选择帧
const selectFrame = (frame: AnimationFrame) => {
  selectedFrameId.value = frame.id
}

// 开始拖动
const startDrag = (event: MouseEvent, frame: AnimationFrame) => {
  console.log('开始拖动:', frame.id, '拖动启用:', isDraggingEnabled.value)
  if (!isDraggingEnabled.value) return

  event.preventDefault()
  event.stopPropagation()
  selectedFrameId.value = frame.id
  isDragging.value = true

  dragStartPos.value = { x: event.clientX, y: event.clientY }
  dragStartOffset.value = {
    x: frame.offsetXPercent || 0,
    y: frame.offsetYPercent || 0,
  }

  console.log('拖动开始位置:', dragStartPos.value, '初始偏移:', dragStartOffset.value)

  // 添加全局鼠标事件监听
  document.addEventListener('mousemove', handleDragMove)
  document.addEventListener('mouseup', handleDragEnd)
}

// 拖动移动
const handleDragMove = (event: MouseEvent) => {
  if (!isDragging.value || selectedFrameId.value === null) return

  const frame = animationFrames.value.find(f => f.id === selectedFrameId.value)
  if (!frame) return

  // 计算移动距离
  const deltaX = event.clientX - dragStartPos.value.x
  const deltaY = event.clientY - dragStartPos.value.y

  // 转换为百分比（基于容器尺寸）
  const deltaXPercent = (deltaX / containerSize.value) * 100
  const deltaYPercent = (deltaY / containerSize.value) * 100

  // 更新偏移
  frame.offsetXPercent = dragStartOffset.value.x + deltaXPercent
  frame.offsetYPercent = dragStartOffset.value.y + deltaYPercent

  console.log('拖动中:', {
    delta: { x: deltaX, y: deltaY },
    percent: { x: deltaXPercent, y: deltaYPercent },
    final: { x: frame.offsetXPercent, y: frame.offsetYPercent },
  })
}

// 结束拖动
const handleDragEnd = () => {
  isDragging.value = false
  document.removeEventListener('mousemove', handleDragMove)
  document.removeEventListener('mouseup', handleDragEnd)
}

// 处理滚轮事件
const handleWheel = (event: WheelEvent, frame: AnimationFrame) => {
  if (!isDraggingEnabled.value) return

  event.preventDefault()
  selectedFrameId.value = frame.id

  // 滚轮调整精度
  const step = 0.5 // 每次滚动0.5%

  if (event.shiftKey) {
    // Shift + 滚轮：调整X轴
    frame.offsetXPercent = (frame.offsetXPercent || 0) + (event.deltaY > 0 ? step : -step)
  } else {
    // 普通滚轮：调整Y轴
    frame.offsetYPercent = (frame.offsetYPercent || 0) + (event.deltaY > 0 ? step : -step)
  }
}
</script>

<style scoped>
.effect-demo-container {
  width: 100vw;
  height: 100vh;
  background: #000;
  color: white;
  font-family: 'Arial', sans-serif;
  overflow: hidden;
}

.demo-header {
  position: absolute;
  top: 20px;
  left: 20px;
  z-index: 100;
}

.demo-header h1 {
  margin: 0 0 10px 0;
  font-size: 24px;
  color: #fff;
  text-shadow: 0 0 10px rgba(255, 255, 255, 0.5);
}

.start-btn {
  padding: 10px 20px;
  background: linear-gradient(45deg, #ff6b6b, #feca57);
  border: none;
  border-radius: 25px;
  color: white;
  font-size: 16px;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 4px 15px rgba(255, 107, 107, 0.3);
}

.start-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(255, 107, 107, 0.4);
}

.start-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
}

/* 容器控制样式 */
.container-controls {
  position: absolute;
  top: 20px;
  right: 20px;
  background: rgba(0, 0, 0, 0.8);
  padding: 10px 15px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 10px;
}

.container-controls label {
  color: #fff;
  font-size: 14px;
  white-space: nowrap;
}

.container-controls input[type='range'] {
  width: 150px;
}

.container-controls span {
  color: #4caf50;
  font-size: 14px;
  font-weight: bold;
  min-width: 60px;
}

.reset-size-btn {
  padding: 4px 8px;
  background: linear-gradient(45deg, #ff9800, #f57c00);
  border: none;
  border-radius: 4px;
  color: white;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.reset-size-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 6px rgba(255, 152, 0, 0.4);
}

.effect-container {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
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
  transition: opacity 0.3s ease-in-out;
  z-index: 10;
  pointer-events: none;
}

.effect-frame.visible {
  pointer-events: auto;
}

.effect-frame.visible {
  opacity: 1;
}

.effect-frame.draggable {
  cursor: move;
}

.effect-frame.selected {
  z-index: 100;
}

.frame-image {
  display: block;
  filter: drop-shadow(0 0 20px rgba(255, 255, 255, 0.5));
  user-select: none;
}

/* 选中边框 */
.selection-border {
  position: absolute;
  top: -5px;
  left: -5px;
  right: -5px;
  bottom: -5px;
  border: 2px solid #00ff00;
  border-radius: 4px;
  pointer-events: none;
  animation: selection-pulse 1.5s ease-in-out infinite;
}

@keyframes selection-pulse {
  0%,
  100% {
    opacity: 1;
    box-shadow: 0 0 10px rgba(0, 255, 0, 0.5);
  }
  50% {
    opacity: 0.6;
    box-shadow: 0 0 20px rgba(0, 255, 0, 0.8);
  }
}

/* 拖动提示 */
.drag-hint {
  position: absolute;
  top: -30px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.8);
  color: #00ff00;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  white-space: nowrap;
  border: 1px solid #00ff00;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.effect-frame:hover .drag-hint {
  opacity: 1;
}

/* 中心参考点样式 */
.center-reference {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 50;
  opacity: 0;
  transition: opacity 0.3s ease-in-out;
  pointer-events: none;
}

.center-reference.visible {
  opacity: 1;
}

.center-cross {
  position: relative;
  width: 100px;
  height: 100px;
}

.horizontal-line {
  position: absolute;
  top: 50%;
  left: 0;
  width: 100%;
  height: 2px;
  background: linear-gradient(90deg, transparent 0%, #ff4444 20%, #ff4444 80%, transparent 100%);
  transform: translateY(-50%);
}

.vertical-line {
  position: absolute;
  left: 50%;
  top: 0;
  width: 2px;
  height: 100%;
  background: linear-gradient(180deg, transparent 0%, #ff4444 20%, #ff4444 80%, transparent 100%);
  transform: translateX(-50%);
}

.center-dot {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 8px;
  height: 8px;
  background: #ff4444;
  border: 2px solid #ffffff;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  box-shadow: 0 0 10px rgba(255, 68, 68, 0.6);
}

.reference-label {
  position: absolute;
  top: -30px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.8);
  color: #ff4444;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  white-space: nowrap;
  border: 1px solid #ff4444;
}

.control-panel {
  position: absolute;
  bottom: 20px;
  left: 20px;
  background: rgba(0, 0, 0, 0.7);
  padding: 15px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  z-index: 100;
}

.animation-info p {
  margin: 5px 0;
  font-size: 14px;
  color: #ccc;
}

.interaction-controls {
  margin-top: 15px;
  padding-top: 15px;
  border-top: 1px solid rgba(255, 255, 255, 0.2);
}

.toggle-drag-btn {
  padding: 8px 16px;
  background: linear-gradient(45deg, #9e9e9e, #757575);
  border: none;
  border-radius: 6px;
  color: white;
  font-size: 14px;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.3s ease;
  margin-bottom: 10px;
}

.toggle-drag-btn.active {
  background: linear-gradient(45deg, #4caf50, #45a049);
  box-shadow: 0 4px 15px rgba(76, 175, 80, 0.3);
}

.toggle-drag-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
}

.help-text {
  font-size: 12px;
  color: #aaa;
  line-height: 1.4;
}

.help-text p {
  margin: 3px 0;
}

.help-text strong {
  color: #fff;
}

/* 调整面板样式 */
.adjustment-panel {
  position: fixed;
  top: 20px;
  right: 20px;
  width: 350px;
  max-height: 80vh;
  background: rgba(0, 0, 0, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 10px;
  z-index: 200;
  overflow: hidden;
  transition: all 0.3s ease;
}

.adjustment-panel.collapsed {
  height: 60px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 15px;
  background: rgba(255, 255, 255, 0.1);
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
}

.panel-header h3 {
  margin: 0;
  color: #fff;
  font-size: 16px;
}

.collapse-btn,
.export-btn,
.preview-btn,
.reset-btn,
.reset-all-btn,
.hide-btn {
  padding: 5px 10px;
  background: linear-gradient(45deg, #4caf50, #45a049);
  border: none;
  border-radius: 5px;
  color: white;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-left: 5px;
}

.export-btn {
  background: linear-gradient(45deg, #2196f3, #1976d2);
}

.preview-btn {
  background: linear-gradient(45deg, #ff9800, #f57c00);
}

.reset-btn {
  background: linear-gradient(45deg, #ff9800, #f57c00);
}

.reset-all-btn {
  background: linear-gradient(45deg, #f44336, #d32f2f);
}

.hide-btn {
  background: linear-gradient(45deg, #9e9e9e, #757575);
}

.collapse-btn:hover,
.export-btn:hover,
.preview-btn:hover,
.reset-btn:hover,
.reset-all-btn:hover,
.hide-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.panel-content {
  max-height: calc(80vh - 80px);
  overflow-y: auto;
  padding: 15px;
}

.frame-controls {
  margin-bottom: 20px;
  padding: 15px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.frame-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 15px;
}

.frame-header h4 {
  margin: 0;
  color: #fff;
  font-size: 14px;
}

.control-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.control-item {
  display: flex;
  flex-direction: column;
}

.control-item label {
  color: #ccc;
  font-size: 12px;
  margin-bottom: 5px;
}

.control-item input {
  padding: 5px 8px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  color: #fff;
  font-size: 12px;
}

.control-item input:focus {
  outline: none;
  border-color: #2196f3;
  box-shadow: 0 0 5px rgba(33, 150, 243, 0.3);
}

.panel-actions {
  display: flex;
  gap: 10px;
  margin-top: 20px;
  padding-top: 15px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

/* 帧控制器样式 */
.frame-controller {
  margin-bottom: 20px;
  padding: 15px;
  background: rgba(33, 150, 243, 0.1);
  border-radius: 8px;
  border: 1px solid rgba(33, 150, 243, 0.3);
}

.frame-controller h4 {
  margin: 0 0 15px 0;
  color: #2196f3;
  font-size: 14px;
  font-weight: bold;
}

.frame-navigator {
  display: flex;
  gap: 5px;
  margin-bottom: 15px;
  flex-wrap: wrap;
}

.frame-nav-btn {
  width: 35px;
  height: 35px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 5px;
  color: #ccc;
  font-size: 14px;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.frame-nav-btn:hover {
  background: rgba(33, 150, 243, 0.3);
  border-color: #2196f3;
  color: #fff;
}

.frame-nav-btn.active {
  background: linear-gradient(45deg, #2196f3, #1976d2);
  border-color: #2196f3;
  color: #fff;
  box-shadow: 0 2px 8px rgba(33, 150, 243, 0.4);
}

.frame-info {
  margin-bottom: 15px;
}

.frame-info p {
  margin: 5px 0;
  font-size: 12px;
  color: #ccc;
}

.frame-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.nav-btn,
.play-btn,
.reference-btn {
  padding: 6px 12px;
  border: none;
  border-radius: 4px;
  color: white;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.nav-btn {
  background: linear-gradient(45deg, #9e9e9e, #757575);
}

.nav-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.nav-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
}

.play-btn {
  background: linear-gradient(45deg, #4caf50, #45a049);
}

.play-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 6px rgba(76, 175, 80, 0.4);
}

.reference-btn {
  background: linear-gradient(45deg, #ff5722, #d84315);
}

.reference-btn.active {
  background: linear-gradient(45deg, #ff4444, #cc0000);
  box-shadow: 0 0 10px rgba(255, 68, 68, 0.4);
}

.reference-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 6px rgba(255, 87, 34, 0.4);
}

.current-frame-controls h4 {
  color: #ff9800;
  margin-bottom: 15px;
  font-size: 14px;
}

/* 导出弹窗样式 */
.export-modal {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.export-content {
  background: #1a1a1a;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 10px;
  padding: 20px;
  width: 90%;
  max-width: 600px;
  max-height: 80vh;
  overflow: hidden;
}

.export-content h3 {
  margin: 0 0 15px 0;
  color: #fff;
  font-size: 18px;
}

.export-textarea {
  width: 100%;
  height: 400px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 5px;
  color: #fff;
  font-family: 'Courier New', monospace;
  font-size: 12px;
  padding: 10px;
  resize: none;
  outline: none;
}

.export-textarea:focus {
  border-color: #2196f3;
  box-shadow: 0 0 10px rgba(33, 150, 243, 0.3);
}

.export-actions {
  display: flex;
  gap: 10px;
  margin-top: 15px;
  justify-content: flex-end;
}

.copy-btn,
.close-btn {
  padding: 8px 16px;
  border: none;
  border-radius: 5px;
  color: white;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.copy-btn {
  background: linear-gradient(45deg, #4caf50, #45a049);
}

.close-btn {
  background: linear-gradient(45deg, #9e9e9e, #757575);
}

.copy-btn:hover,
.close-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}
</style>
