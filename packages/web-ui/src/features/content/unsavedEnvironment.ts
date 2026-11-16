import { inject, onBeforeUnmount, type InjectionKey } from 'vue'
import { ElMessageBox } from 'element-plus'

export const environmentDraftsKey: InjectionKey<Set<() => boolean>> = Symbol('environmentDrafts')
export function registerEnvironmentDraft(isDirty: () => boolean) {
  const drafts = inject(environmentDraftsKey, undefined)
  drafts?.add(isDirty)
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
