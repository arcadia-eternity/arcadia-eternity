import { onMounted, onUnmounted } from 'vue'

export interface EditorKeyboardHandlers {
  onSave?: () => void
  onUndo?: () => void
  onRedo?: () => void
  onSelectAll?: () => void
  onDelete?: () => void
}

function isTextInputFocused(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  const tag = el.tagName.toLowerCase()
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    el.isContentEditable
  )
}

export function useEditorKeyboard(handlers: EditorKeyboardHandlers): void {
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
      handlers.onUndo?.()
      return
    }

    if (mod && e.key === 'z' && e.shiftKey) {
      e.preventDefault()
      handlers.onRedo?.()
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
