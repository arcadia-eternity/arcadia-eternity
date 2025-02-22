import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import LobbyView from '../views/lobbyView.vue'
import BattleView from '../views/battleViews.vue'

// 路由守卫
import { battleGuard } from './guards'
import TeamBuilder from '@/views/teamBuilder.vue'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Lobby',
    component: LobbyView,
    meta: {
      title: '匹配大厅',
    },
  },
  {
    path: '/battle',
    name: 'Battle',
    component: BattleView,
    meta: {
      title: '对战界面',
      requiresBattle: true, // 需要有效对战会话
    },
  },
  {
    path: '/team-builder',
    name: 'TeamBuilder',
    component: TeamBuilder,
    meta: {
      title: '队伍编辑器',
    },
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior(to, from, savedPosition) {
    return savedPosition || { top: 0 }
  },
})

// 全局路由守卫
router.beforeEach(battleGuard)

// 动态设置页面标题
router.afterEach(to => {
  const title = (to.meta.title as string) || '赛尔号对战'
  document.title = `${title} | PokeBattle`
})

export default router
