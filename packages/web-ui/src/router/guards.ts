import type { RouteLocationNormalized } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useBattleStore } from '@/stores/battle'
import { useBattleClientStore } from '@/stores/battleClient'

export const battleGuard = async (to: RouteLocationNormalized, from: RouteLocationNormalized) => {
  const store = useBattleStore()
  const battleClientStore = useBattleClientStore()

  // 需要有效对战的页面
  if (to.meta.requiresBattle) {
    const isPrivateRoomBattle = to.query.privateRoom === 'true'
    const isServerBattle = typeof to.query.roomId === 'string' && to.query.roomId.length > 0
    const isP2PBattle = to.query.p2p === 'true'
    const hasRoomCode = typeof to.query.roomCode === 'string' && to.query.roomCode.length > 0

    if (isPrivateRoomBattle && hasRoomCode && (isServerBattle || isP2PBattle)) return true

    if (from.name === 'Lobby') {
      if (battleClientStore.currentState.matchmaking === 'idle') {
        ElMessage.warning('请先进入匹配队列')
        return '/'
      }
      return true
    }
    if (from.name === 'LocalBattle') {
      return true
    }
    if (from.name === 'PrivateRoom') {
      ElMessage.warning('无效的私人房间战斗参数')
      return '/'
    }
    return '/'
  }

  // 离开对战页面处理
  if (from.name === 'Battle' && to.name !== 'Battle') {
    // 如果是回放模式或战斗已结束，直接清理并跳转
    if (store.isReplayMode || store.isBattleEnd) {
      store.resetBattle()
      return true
    }

    // 正在进行的战斗需要确认
    try {
      await ElMessageBox.confirm('确定要离开对战吗？当前进度将会丢失', '警告', {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      })
      store.resetBattle()
      return true
    } catch {
      return false
    }
  }

  return true
}
