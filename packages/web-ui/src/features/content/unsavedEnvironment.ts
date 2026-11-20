import { inject, provide, shallowReactive, onBeforeUnmount, type InjectionKey } from 'vue'
import { ElMessageBox } from 'element-plus'

const environmentDraftsKey: InjectionKey<Map<() => boolean, () => boolean>> = Symbol('environmentDrafts')
export function useEnvironmentDrafts() {
  const drafts = inject(environmentDraftsKey, undefined) ?? shallowReactive(new Map<() => boolean, () => boolean>())
  provide(environmentDraftsKey, drafts)
  return {
    dirty: () => [...drafts.keys()].some(check => check()),
    open: () => [...drafts.values()].some(check => check()),
  }
}
export function registerEnvironmentDraft(isDirty: () => boolean, isOpen = isDirty) {
  const drafts = inject(environmentDraftsKey, undefined)
  drafts?.set(isDirty, isOpen)
  onBeforeUnmount(() => drafts?.delete(isDirty))
}
export async function discardEnvironmentChanges() {
  try {
    await ElMessageBox.confirm('未保存的环境修改将丢失。', '放弃修改？', {
      confirmButtonText: '放弃修改',
      cancelButtonText: '继续编辑',
      type: 'warning',
    })
    return true
  } catch {
    return false
  }
}
