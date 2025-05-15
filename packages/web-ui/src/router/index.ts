import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import LobbyView from '../pages/lobbyPage.vue'
// import BattleView from '../pages/battlePage.vue'
const BattleView = () => import('../pages/battlePage.vue')
import LocalBattlePage from '../pages/localBattlePage.vue'
// import DataEditor from '../pages/dataEditor.vue'
// import EffectGraphEditor from '@/pages/EffectGraphEditor.vue'

// 路由守卫
import { battleGuard } from './guards'
import TeamBuilder from '@/pages/teamBuilder.vue'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Lobby',
    component: LobbyView,
    meta: {
      title: '匹配大厅',
    },
    props: route => ({
      // 将查询参数转换为props
      startMatching: route.query.startMatching === 'true',
    }),
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
    path: '/local-battle',
    name: 'LocalBattle',
    component: LocalBattlePage,
    meta: {
      title: '本地对战测试',
    },
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
]

// const devOnlyRoutes: RouteRecordRaw[] = [
//   {
//     path: '/data-editor',
//     name: 'DataEditor',
//     component: DataEditor,
//     meta: {
//       title: '数据编辑器',
//     },
//   },
//   {
//     path: '/effect-editor',
//     name: 'EffectGraphEditor',
//     component: EffectGraphEditor,
//     props: true,
//   },
// ]

// if (import.meta.env.DEV) {
//   routes.push(...devOnlyRoutes)
// }

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
  const title = (to.meta.title as string) || '阿卡迪亚:永恒之门'
  document.title = `${title} | Arcadia Eternity`
})

export default router
