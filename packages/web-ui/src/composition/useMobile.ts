import { ref, computed, onMounted, onUnmounted } from 'vue'

// 全局移动端检测状态
const windowWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1024)
const windowHeight = ref(typeof window !== 'undefined' ? window.innerHeight : 768)

// 移动端检测逻辑
const isMobile = computed(() => {
  // 基于屏幕宽度的检测
  const isSmallScreen = windowWidth.value < 768
  
  // 基于用户代理的检测
  const isMobileDevice = typeof navigator !== 'undefined' && 
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
  
  return isSmallScreen || isMobileDevice
})

// 屏幕方向检测
const isPortrait = computed(() => windowHeight.value > windowWidth.value)
const isLandscape = computed(() => windowWidth.value > windowHeight.value)

// 窗口大小变化处理
const handleResize = () => {
  windowWidth.value = window.innerWidth
  windowHeight.value = window.innerHeight
}

// 监听器管理
let isListenerAdded = false

export function useMobile() {
  // 确保只添加一次全局监听器
  onMounted(() => {
    if (!isListenerAdded && typeof window !== 'undefined') {
      window.addEventListener('resize', handleResize)
      isListenerAdded = true
    }
  })

  // 清理监听器（只在最后一个组件卸载时清理）
  onUnmounted(() => {
    // 注意：这里不清理全局监听器，因为可能有多个组件在使用
    // 全局监听器会在页面卸载时自动清理
  })

  return {
    windowWidth: computed(() => windowWidth.value),
    windowHeight: computed(() => windowHeight.value),
    isMobile,
    isPortrait,
    isLandscape,
  }
}

// 导出全局清理函数（可在App.vue中调用）
export function cleanupMobileListener() {
  if (typeof window !== 'undefined' && isListenerAdded) {
    window.removeEventListener('resize', handleResize)
    isListenerAdded = false
  }
}
