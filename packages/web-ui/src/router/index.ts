import { createRouter, createWebHistory, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import LobbyView from '../pages/lobbyPage.vue'
// import BattleView from '../pages/battlePage.vue'
const BattleView = () => import('../pages/battlePage.vue')
// import LocalBattlePage from '../pages/localBattlePage.vue'
const LocalBattlePage = () => import('../pages/localBattlePage.vue')

// 路由守卫
import { battleGuard } from './guards'
import TeamBuilder from '@/pages/teamBuilder.vue'
import StorageManager from '@/pages/storageManager.vue'
import AccountPage from '@/pages/accountPage.vue'
import { isDesktop, isStaticMode } from '@/utils/env'
import { captureOAuthCallbackAtBoot } from '@/services/serverSession'

// 战报相关组件
const LocalBattleReports = () => import('@/components/battleReport/LocalBattleReports.vue')
// Select the loader, not an import inside a shared loader. The production
// bundler can merge conditional imports and retain only the fallback CSS deps.
const LocalContentOnlyPage = () => import('@/features/content/LocalContentOnlyPage.vue')
const routes: RouteRecordRaw[] = [
  {
    path: '/servers',
    name: 'Servers',
    component: () => import('@/features/servers/ServersPage.vue'),
    meta: { title: '服务器' },
  },
  {
    path: '/management',
    name: 'Management',
    component: () => import('@/features/management/ManagementPage.vue'),
    meta: { title: '环境与服务器管理' },
  },
  {
    path: '/content/preview',
    name: 'AuthorPreview',
    component: () => import('@/features/authoring/AuthorPreviewPage.vue'),
    meta: { title: '内容包试玩' },
  },
  {
    path: '/content',
    name: 'ContentManager',
    component: () => import('@/features/content/ContentManagerPage.vue'),
    meta: { title: '内容包' },
  },
  {
    path: '/settings/local-service',
    name: 'LocalContentService',
    component: isDesktop ? () => import('@/features/content/LocalServicePage.vue') : LocalContentOnlyPage,
    meta: { title: '高级本机工具' },
  },
  {
    path: '/content/development',
    name: 'DevelopmentWorkspace',
    component: isDesktop ? () => import('@/features/development/DevelopmentWorkspacePage.vue') : LocalContentOnlyPage,
    meta: { title: '开发服务工作区' },
  },
  {
    path: '/content/edit/:projectId?',
    name: 'AuthorWorkspace',
    component: isDesktop ? () => import('@/features/authoring/AuthorWorkspacePage.vue') : LocalContentOnlyPage,
    meta: { title: '编辑内容包' },
  },
  {
    path: '/',
    alias: '/lobby',
    name: 'Lobby',
    beforeEnter: route => {
      if (route.query.entry === 'management') return { path: '/management', query: { target: 'server' } }
      if (route.query.startMatching === 'true') return { name: 'Matchmaking' }
      return true
    },
    component: LobbyView,
    meta: {
      title: '好友大厅',
      requiresServer: true,
    },
  },
  {
    path: '/matchmaking',
    name: 'Matchmaking',
    component: () => import('@/pages/MatchmakingPage.vue'),
    meta: { title: '普通匹配', requiresServer: true },
  },
  {
    path: '/battle',
    name: 'Battle',
    component: BattleView,
    props: route => ({
      enableDeveloperMode: route.query.dev === 'true',
      privateRoom: route.query.privateRoom === 'true',
      roomCode: route.query.roomCode as string,
      spectatorMode: route.query.spectate === 'true',
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
      requiresServer: true,
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
      serverOnly: true,
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

const devOnlyRoutes: RouteRecordRaw[] = []

if (import.meta.env.DEV) {
  routes.push(...devOnlyRoutes)
}

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

if (!isDesktop) {
  routes.push(...webOnlyRoutes)
}

// Capture before history remembers the initial URL, so mounting cannot restore the one-time query.
if (!isStaticMode) captureOAuthCallbackAtBoot(window.location, window.history)

const router = createRouter({
  history: isStaticMode ? createWebHashHistory() : createWebHistory(import.meta.env.BASE_URL),
  routes: isStaticMode
    ? [
        { path: '/', redirect: '/local-battle' },
        ...routes.filter(route => !route.meta?.requiresServer && !route.meta?.serverOnly),
      ]
    : routes,
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
