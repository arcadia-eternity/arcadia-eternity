import type { NavigationGuardNext, RouteLocationNormalized } from 'vue-router'
import { useBattleStore } from '@/stores/battle'
import { useBattleClientStore } from '@/stores/battleClient'

export const battleGuard = (to: RouteLocationNormalized, from: RouteLocationNormalized, next: NavigationGuardNext) => {
  const store = useBattleStore()
  const battleClientStore = useBattleClientStore()

  // 需要有效对战的页面
  if (to.meta.requiresBattle) {
    if (from.name === 'Lobby') {
      if (battleClientStore.currentState.matchmaking === 'idle') {
        ElMessage.warning('请先进入匹配队列')
        return next('/')
      }
      return next()
    } else if (from.name === 'LocalBattle') {
      return next()
    } else {
      return next('/')
    }
  }

  // 离开对战页面处理
  if (from.name === 'Battle' && to.name !== 'Battle') {
    // 如果是回放模式或战斗已结束，直接清理并跳转
    if (store.isReplayMode || store.isBattleEnd) {
      store.resetBattle()
      next()
    } else {
      // 正在进行的战斗需要确认
      ElMessageBox.confirm('确定要离开对战吗？当前进度将会丢失', '警告', {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      })
        .then(() => {
          store.resetBattle()
          next()
        })
        .catch(() => {
          next(false)
        })
    }
  } else {
    next()
  }
}
