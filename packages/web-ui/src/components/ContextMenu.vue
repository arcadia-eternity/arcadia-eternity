<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { ElDropdown, ElDropdownMenu, ElDropdownItem, type DropdownInstance } from 'element-plus'
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

const anchor = ref<HTMLElement>()
const dropdown = ref<DropdownInstance>()
watch(
  () => [props.visible, props.position] as const,
  async ([visible]) => {
    await nextTick()
    if (visible) dropdown.value?.handleOpen()
    else dropdown.value?.handleClose()
  },
  { immediate: true },
)

function choose(index: number) {
  const item = props.menuItems[index]
  if (!item || item.disabled) return
  emit('close')
  item.action()
}
</script>
<template>
  <span ref="anchor" class="context-anchor" :style="{ left: position.x + 'px', top: position.y + 'px' }" />
  <ElDropdown
    ref="dropdown"
    virtual-triggering
    :virtual-ref="anchor"
    trigger="contextmenu"
    placement="bottom-start"
    :show-timeout="0"
    :hide-timeout="0"
    @command="choose"
    @visible-change="
      open => {
        if (!open && visible) emit('close')
      }
    "
  >
    <template #dropdown>
      <ElDropdownMenu aria-label="精灵操作">
        <ElDropdownItem
          v-for="(item, index) in menuItems"
          :key="index"
          :command="index"
          :disabled="item.disabled"
          :divided="item.danger"
        >
          <svg
            v-if="item.iconPath"
            class="size-4 mr-2"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="item.iconPath" />
          </svg>
          <span :class="{ 'text-red-600': item.danger }">{{ item.label }}</span>
        </ElDropdownItem>
      </ElDropdownMenu>
    </template>
  </ElDropdown>
</template>
<style scoped>
.context-anchor {
  position: fixed;
  width: 1px;
  height: 1px;
  pointer-events: none;
}
</style>
