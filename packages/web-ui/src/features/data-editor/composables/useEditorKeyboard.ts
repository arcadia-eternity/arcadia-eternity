import { onMounted, onUnmounted } from 'vue'
import { useThrottleFn } from '@vueuse/core'

export interface EditorKeyboardHandlers {
  onSave?: () => void
  onUndo?: () => void
  onRedo?: () => void
  onSelectAll?: () => void
  onDelete?: () => void
}

/** Throttle interval for undo/redo keyboard shortcuts (ms) — prevents rapid-fire from OS key repeat. */
const KEYBOARD_THROTTLE_MS = 200

function isTextInputFocused(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  const tag = el.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || el.isContentEditable
}

export function useEditorKeyboard(handlers: EditorKeyboardHandlers): void {
  const throttledUndo = useThrottleFn(() => handlers.onUndo?.(), KEYBOARD_THROTTLE_MS, false)
  const throttledRedo = useThrottleFn(() => handlers.onRedo?.(), KEYBOARD_THROTTLE_MS, false)

  function handleKeydown(e: KeyboardEvent): void {
    const mod = e.metaKey || e.ctrlKey

    if (mod && e.key === 's') {
      e.preventDefault()
      handlers.onSave?.()
      return
    }

    if (isTextInputFocused()) return

    if (mod && e.key === 'z' && !e.shiftKey) {
      e.preventDefault()
      throttledUndo()
      return
    }

    if (mod && e.key === 'z' && e.shiftKey) {
      e.preventDefault()
      throttledRedo()
      return
    }

    if (mod && e.key === 'a') {
      e.preventDefault()
      handlers.onSelectAll?.()
      return
    }

    if (e.key === 'Delete') {
      e.preventDefault()
      handlers.onDelete?.()
      return
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', handleKeydown)
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeydown)
  })
}
