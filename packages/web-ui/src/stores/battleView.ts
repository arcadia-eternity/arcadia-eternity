import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useWindowSize } from '@vueuse/core'

export const useBattleViewStore = defineStore('battleView', () => {
  // battleView的固定尺寸
  const BATTLE_VIEW_WIDTH = 1600
  const BATTLE_VIEW_HEIGHT = 900

  // 窗口尺寸
  const { width: windowWidth, height: windowHeight } = useWindowSize()

  // 计算缩放比例
  const scale = computed(() => {
    // 为计时器和其他UI元素预留空间
    const availableWidth = windowWidth.value - 32 // 左右各16px的边距
    const availableHeight = windowHeight.value - 32 // 上下各16px的边距
    
    // 计算基于宽度和高度的缩放比例
    const scaleX = availableWidth / BATTLE_VIEW_WIDTH
    const scaleY = availableHeight / BATTLE_VIEW_HEIGHT
    
    // 使用较小的缩放比例以确保完全适应屏幕，最大不超过1
    const calculatedScale = Math.min(scaleX, scaleY, 1)
    
    // 设置最小缩放比例，避免过小
    return Math.max(calculatedScale, 0.3)
  })

  return {
    scale,
    BATTLE_VIEW_WIDTH,
    BATTLE_VIEW_HEIGHT,
  }
})
