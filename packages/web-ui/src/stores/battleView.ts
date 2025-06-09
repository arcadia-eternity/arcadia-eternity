import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useWindowSize } from '@vueuse/core'

export const useBattleViewStore = defineStore('battleView', () => {
  // battleView的固定尺寸
  const BATTLE_VIEW_WIDTH = 1600
  const BATTLE_VIEW_HEIGHT = 900

  // 固定宽高比 (16:9)
  const ASPECT_RATIO = BATTLE_VIEW_WIDTH / BATTLE_VIEW_HEIGHT

  // 窗口尺寸
  const { width: windowWidth, height: windowHeight } = useWindowSize()

  // 父容器尺寸（用于自适应缩放）
  const containerWidth = ref(0)
  const containerHeight = ref(0)

  // 缩放限制
  const MIN_SCALE = 0.2
  const MAX_SCALE = 2.0

  // 是否启用自适应缩放模式
  const adaptiveScaling = ref(false)

  // 日志面板显示状态
  const showLogPanel = ref(true)

  // 计算自适应缩放比例
  const calculateAdaptiveScale = (containerW: number, containerH: number, padding = 32) => {
    if (containerW <= 0 || containerH <= 0) return MIN_SCALE

    // 减去内边距，为UI元素预留空间
    const availableWidth = Math.max(0, containerW - padding)
    const availableHeight = Math.max(0, containerH - padding)

    // 计算基于容器的缩放比例，保持宽高比
    const scaleX = availableWidth / BATTLE_VIEW_WIDTH
    const scaleY = availableHeight / BATTLE_VIEW_HEIGHT

    // 选择较小的缩放比例以确保完全适应容器
    const calculatedScale = Math.min(scaleX, scaleY)

    // 应用缩放限制
    return Math.max(MIN_SCALE, Math.min(MAX_SCALE, calculatedScale))
  }

  // 计算缩放比例
  const scale = computed(() => {
    // 如果启用自适应缩放且有有效的容器尺寸，使用容器尺寸计算
    if (adaptiveScaling.value && containerWidth.value > 0 && containerHeight.value > 0) {
      return calculateAdaptiveScale(containerWidth.value, containerHeight.value, 32)
    }

    // 否则使用窗口尺寸计算逻辑
    const availableWidth = windowWidth.value - 32 // 左右各16px的边距
    const availableHeight = windowHeight.value - 32 // 上下各16px的边距

    const scaleX = availableWidth / BATTLE_VIEW_WIDTH
    const scaleY = availableHeight / BATTLE_VIEW_HEIGHT

    const calculatedScale = Math.min(scaleX, scaleY, 1)
    return Math.max(calculatedScale, 0.3)
  })

  // 切换日志面板显示状态
  const toggleLogPanel = () => {
    showLogPanel.value = !showLogPanel.value
  }

  // 设置父容器尺寸（用于自适应缩放）
  const setContainerSize = (width: number, height: number) => {
    containerWidth.value = width
    containerHeight.value = height
  }

  // 启用/禁用自适应缩放
  const setAdaptiveScaling = (enabled: boolean) => {
    adaptiveScaling.value = enabled
  }

  // 获取计算后的战斗视图尺寸（应用缩放后）
  const scaledBattleViewSize = computed(() => {
    const currentScale = scale.value
    return {
      width: BATTLE_VIEW_WIDTH * currentScale,
      height: BATTLE_VIEW_HEIGHT * currentScale,
    }
  })

  return {
    // 基础属性
    scale,
    BATTLE_VIEW_WIDTH,
    BATTLE_VIEW_HEIGHT,
    ASPECT_RATIO,
    MIN_SCALE,
    MAX_SCALE,

    // UI状态
    showLogPanel,
    toggleLogPanel,

    // 自适应缩放
    adaptiveScaling,
    containerWidth,
    containerHeight,
    setContainerSize,
    setAdaptiveScaling,
    calculateAdaptiveScale,
    scaledBattleViewSize,
  }
})
