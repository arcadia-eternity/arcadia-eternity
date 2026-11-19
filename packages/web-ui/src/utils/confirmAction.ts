import { ElMessageBox } from 'element-plus'
import 'element-plus/theme-chalk/el-message-box.css'

export async function confirmAction(action: string, consequence: string) {
  try {
    await ElMessageBox.confirm(consequence, action, {
      type: 'warning',
      confirmButtonText: action,
      cancelButtonText: '取消',
      closeOnClickModal: false,
    })
    return true
  } catch {
    return false
  }
}
