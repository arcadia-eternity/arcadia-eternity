<template>
  <div
    v-if="visible"
    ref="menuRef"
    class="fixed bg-white rounded-lg shadow-lg border border-gray-200 py-2 min-w-48"
    :class="{ 'mobile-menu': isMobile, 'z-50': !isMobile, 'z-[9999]': isMobile }"
    :style="menuStyle"
    @click.stop
  >
    <div
      v-for="(item, index) in menuItems"
      :key="index"
      class="px-4 py-3 text-sm text-gray-700 hover:bg-gray-100 cursor-pointer flex items-center space-x-3 transition-colors duration-150"
      :class="{
        'text-red-600 hover:bg-red-50': item.danger,
        'text-gray-400 cursor-not-allowed hover:bg-transparent': item.disabled,
        'py-4': isMobile, // 移动端增加触摸区域
      }"
      @click="!item.disabled && handleItemClick(item)"
      @touchend="!item.disabled && handleItemClick(item)"
    >
      <svg v-if="item.iconPath" class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="item.iconPath" />
      </svg>
      <span class="flex-1">{{ item.label }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, onUnmounted, watch, computed } from 'vue'

interface MenuItem {
  label: string
  iconPath: string
  action: () => void
  danger?: boolean
  disabled?: boolean
}

interface Props {
  visible: boolean
  position: { x: number; y: number }
  menuItems: MenuItem[]
}

const props = defineProps<Props>()
const emit = defineEmits(['close'])

const menuRef = ref<HTMLElement>()

// 检测是否为移动设备
const isMobile = computed(() => {
  return (
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    window.innerWidth <= 768
  )
})

// 计算菜单样式
const menuStyle = computed(() => {
  if (isMobile.value) {
    // 移动端居中显示，确保可点击
    return {
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
      maxWidth: '90vw',
      maxHeight: '80vh',
      overflowY: 'auto' as const,
      zIndex: '9999', // 确保在最顶层
      pointerEvents: 'auto' as const, // 确保可以点击
    }
  } else {
    // 桌面端按位置显示
    return {
      left: props.position.x + 'px',
      top: props.position.y + 'px',
      pointerEvents: 'auto' as const,
    }
  }
})

const handleItemClick = (item: MenuItem) => {
  item.action()
  emit('close')
}

const handleClickOutside = (event: MouseEvent | TouchEvent) => {
  if (menuRef.value && !menuRef.value.contains(event.target as Node)) {
    emit('close')
  }
}

const handleEscape = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    emit('close')
  }
}

const addEventListeners = () => {
  document.addEventListener('click', handleClickOutside)
  document.addEventListener('touchend', handleClickOutside) // 添加触摸事件支持
  document.addEventListener('keydown', handleEscape)
}

const removeEventListeners = () => {
  document.removeEventListener('click', handleClickOutside)
  document.removeEventListener('touchend', handleClickOutside) // 移除触摸事件监听
  document.removeEventListener('keydown', handleEscape)
}

const adjustPosition = () => {
  nextTick(() => {
    if (menuRef.value && !isMobile.value) {
      // 只在桌面端调整位置，移动端使用居中显示
      const rect = menuRef.value.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight

      let { x, y } = props.position

      if (x + rect.width > viewportWidth) {
        x = viewportWidth - rect.width - 10
      }

      if (y + rect.height > viewportHeight) {
        y = viewportHeight - rect.height - 10
      }

      menuRef.value.style.left = x + 'px'
      menuRef.value.style.top = y + 'px'
    }
  })
}

// 监听visible属性变化
watch(
  () => props.visible,
  newVisible => {
    if (newVisible) {
      // 菜单显示时添加事件监听器并调整位置
      nextTick(() => {
        addEventListeners()
        adjustPosition()
      })
    } else {
      // 菜单隐藏时移除事件监听器
      removeEventListeners()
    }
  },
  { immediate: true },
)

onUnmounted(() => {
  removeEventListeners()
})
</script>

<style scoped>
/* 菜单动画 */
.context-menu-enter-active,
.context-menu-leave-active {
  transition: all 0.2s ease;
}

.context-menu-enter-from,
.context-menu-leave-to {
  opacity: 0;
  transform: scale(0.95);
}

/* 移动端样式 */
.mobile-menu {
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.15);
  border-radius: 12px;
  min-width: 200px;
  background-color: white;
  pointer-events: auto;
}

/* 移动端触摸优化 */
@media (max-width: 768px) {
  .mobile-menu > div {
    min-height: 48px; /* 确保足够的触摸区域 */
    display: flex;
    align-items: center;
    -webkit-tap-highlight-color: rgba(59, 130, 246, 0.1);
  }
}

/* 防止移动端选择文本 */
.mobile-menu * {
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
}
</style>
