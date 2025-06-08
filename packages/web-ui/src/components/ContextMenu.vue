<template>
  <div
    v-if="visible"
    ref="menuRef"
    class="fixed z-50 bg-white rounded-lg shadow-lg border border-gray-200 py-2 min-w-48"
    :style="{ left: position.x + 'px', top: position.y + 'px' }"
    @click.stop
  >
    <div
      v-for="(item, index) in menuItems"
      :key="index"
      class="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 cursor-pointer flex items-center space-x-3"
      :class="{
        'text-red-600 hover:bg-red-50': item.danger,
        'text-gray-400 cursor-not-allowed hover:bg-transparent': item.disabled,
      }"
      @click="!item.disabled && handleItemClick(item)"
    >
      <svg v-if="item.iconPath" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="item.iconPath" />
      </svg>
      <span>{{ item.label }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, onMounted, onUnmounted, watch } from 'vue'

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

const handleItemClick = (item: MenuItem) => {
  item.action()
  emit('close')
}

const handleClickOutside = (event: MouseEvent) => {
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
  document.addEventListener('keydown', handleEscape)
}

const removeEventListeners = () => {
  document.removeEventListener('click', handleClickOutside)
  document.removeEventListener('keydown', handleEscape)
}

const adjustPosition = () => {
  nextTick(() => {
    if (menuRef.value) {
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
</style>
