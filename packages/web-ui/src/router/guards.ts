import type { NavigationGuardNext, RouteLocationNormalized } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useBattleStore } from '@/stores/battle'
import { battleClient } from '@/utils/battleClient'

export const battleGuard = (to: RouteLocationNormalized, from: RouteLocationNormalized, next: NavigationGuardNext) => {
  const store = useBattleStore()

  // 需要有效对战的页面
  if (to.meta.requiresBattle) {
    if (from.name === 'Battle' && battleClient.currentState.matchmaking !== 'matched') {
      ElMessage.warning('请先进入匹配队列')
      return next('/')
    } else if (import.meta.env.DEV && from.name === 'LocalBattle') {
    } else {
      return next('/')
    }
  }

  // 离开对战页面确认
  if (from.name === 'Battle' && to.name !== 'Battle' && !store.isBattleEnd) {
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
  } else {
    next()
  }
}
