import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import LobbyView from '../pages/lobbyPage.vue'
// import BattleView from '../pages/battlePage.vue'
const BattleView = () => import('../pages/battlePage.vue')
// import LocalBattlePage from '../pages/localBattlePage.vue'
const LocalBattlePage = () => import('../pages/localBattlePage.vue')
// import DataEditor from '../pages/dataEditor.vue'
// import EffectGraphEditor from '@/pages/EffectGraphEditor.vue'

// 路由守卫
import { battleGuard } from './guards'
import TeamBuilder from '@/pages/teamBuilder.vue'
import StorageManager from '@/pages/storageManager.vue'
import AccountPage from '@/pages/accountPage.vue'
import { isTauri } from '@/utils/env'

// 战报相关组件
const BattleRecordList = () => import('@/components/battleReport/BattleRecordList.vue')
const BattleRecordDetail = () => import('@/components/battleReport/BattleRecordDetail.vue')
const LocalBattleReports = () => import('@/components/battleReport/LocalBattleReports.vue')
const Leaderboard = () => import('@/components/battleReport/Leaderboard.vue')
const PlayerBattleRecords = () => import('@/components/battleReport/PlayerBattleRecords.vue')

// 演示页面
const ParticleEffectDemo = () => import('@/pages/ParticleEffectDemo.vue')
const ClimaxEffectDemo = () => import('@/pages/ClimaxEffectDemo.vue')

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
    props: route => ({
      enableDeveloperMode: route.query.dev === 'true',
      privateRoom: route.query.privateRoom === 'true',
      roomCode: route.query.roomCode as string,
    }),
    meta: {
      title: '对战界面',
      requiresBattle: true, // 需要有效对战会话
    },
  },
  {
    path: '/room/:roomCode',
    name: 'PrivateRoom',
    component: () => import('@/pages/PrivateRoomPage.vue'),
    props: true,
    meta: {
      title: '私人房间',
      requiresAuth: false, // 私人房间不需要强制认证
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
    path: '/storage',
    name: 'StorageManager',
    component: StorageManager,
    meta: {
      title: '精灵仓库',
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
    path: '/account',
    name: 'Account',
    component: AccountPage,
    meta: {
      title: '账户管理',
    },
  },

  {
    path: '/dex',
    name: 'Dex',
    component: () => import('@/pages/DexPage.vue'),
    meta: {
      title: '图鉴',
    },
  },
  {
    path: '/dex/species/:id',
    name: 'SpeciesDetail',
    component: () => import('@/components/dex/SpeciesDetail.vue'),
    meta: {
      title: '精灵详情',
    },
  },
  {
    path: '/dex/skill/:id',
    name: 'SkillDetail',
    component: () => import('@/components/dex/SkillDetail.vue'),
    meta: {
      title: '技能详情',
    },
  },
  {
    path: '/dex/mark/:id',
    name: 'MarkDetail',
    component: () => import('@/components/dex/MarkDetail.vue'),
    meta: {
      title: '印记详情',
    },
  },
  {
    path: '/dex/type-chart',
    name: 'TypeChart',
    component: () => import('@/components/dex/TypeChart.vue'),
    meta: {
      title: '属性克制表',
    },
  },

  // 战报相关路由
  {
    path: '/battle-reports',
    name: 'BattleReports',
    component: BattleRecordList,
    meta: {
      title: '战报记录',
    },
  },
  {
    path: '/battle-reports/:id',
    name: 'BattleReportDetail',
    component: BattleRecordDetail,
    meta: {
      title: '战报详情',
    },
  },
  {
    path: '/battle-reports/:id/preview',
    name: 'BattleReportPreview',
    component: BattleView,
    props: route => ({
      replayMode: true,
      battleRecordId: route.params.id,
    }),
    meta: {
      title: '战报预览',
    },
  },
  {
    path: '/leaderboard',
    name: 'Leaderboard',
    component: Leaderboard,
    meta: {
      title: '排行榜',
    },
  },
  {
    path: '/players/:playerId/battles',
    name: 'PlayerBattleRecords',
    component: PlayerBattleRecords,
    meta: {
      title: '玩家战报',
    },
  },
  // 本地战报相关路由
  {
    path: '/local-battle-reports',
    name: 'LocalBattleReports',
    component: LocalBattleReports,
    meta: {
      title: '本地战报管理',
    },
  },
  {
    path: '/local-battle-reports/:id/play',
    name: 'LocalBattleReportPlay',
    component: BattleView,
    props: route => ({
      replayMode: true,
      localReportId: route.params.id,
    }),
    meta: {
      title: '本地战报回放',
    },
  },

  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
]

const devOnlyRoutes: RouteRecordRaw[] = [
  // {
  //   path: '/data-editor',
  //   name: 'DataEditor',
  //   component: DataEditor,
  //   meta: {
  //     title: '数据编辑器',
  //   },
  // },
  // {
  //   path: '/effect-editor',
  //   name: 'EffectGraphEditor',
  //   component: EffectGraphEditor,
  //   props: true,
  // },  // 演示页面路由
  {
    path: '/particle-demo',
    name: 'ParticleEffectDemo',
    component: ParticleEffectDemo,
    meta: {
      title: '必杀技特效调整页面',
    },
  },
  {
    path: '/climax-demo',
    name: 'ClimaxEffectDemo',
    component: ClimaxEffectDemo,
    meta: {
      title: '必杀技特性动画组件演示',
    },
  },
]

if (import.meta.env.DEV) {
  routes.push(...devOnlyRoutes)
}

const tauriOnlyRoutes: RouteRecordRaw[] = [
  // 移除更新页面，使用左下角轻量版本信息代替
]

const webOnlyRoutes: RouteRecordRaw[] = [
  {
    path: '/download',
    name: 'Download',
    component: () => import('@/pages/downloadPage.vue'),
    meta: {
      title: '下载客户端',
    },
  },
]

if (isTauri) {
  routes.push(...tauriOnlyRoutes)
} else {
  routes.push(...webOnlyRoutes)
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior(_to, _from, savedPosition) {
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
