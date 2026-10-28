import { createApp } from 'vue'
import { createPinia } from 'pinia'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import { createPersistedState } from 'pinia-plugin-persistedstate'
import I18NextVue from 'i18next-vue'
import Particles from '@tsparticles/vue3'
import { loadFull } from 'tsparticles'

import App from './App.vue'
import router from './router'
import { initI18n } from './i18n/i18n'
import i18next from 'i18next'
import { useAuthStore } from './stores/auth'
import { usePrivateRoomStore } from './stores/privateRoom'
import { ensureRuffleRuntime } from './bootstrap/ruffle'
import { isStaticMode } from './utils/env'
import { localDataStorage } from './services/localStorage'

async function bootstrap() {
  const animationRuntime = ensureRuffleRuntime().catch(error => {
    if (isStaticMode) {
      throw new Error('本地动画资源未完整加载，请重新联网后刷新重试。', { cause: error })
    }
    console.warn('Ruffle runtime preload failed, fallback loader may be used:', error)
  })
  // Editing teams and other web pages can mount while the optional animation runtime loads.
  if (isStaticMode) await animationRuntime

  const app = createApp(App)
  const pinia = createPinia()
  initI18n()
  pinia.use(createPersistedState({ storage: localDataStorage }))

  app.use(pinia)
  app.use(router)
  app.use(I18NextVue, { i18next })
  app.use(Particles, {
    init: async engine => {
      await loadFull(engine)
    },
  })
  for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
    app.component(key, component)
  }

  if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
    ;(
      window as typeof window & {
        __APP_DEBUG__?: {
          pinia: typeof pinia
          stores: {
            auth: () => ReturnType<typeof useAuthStore>
            privateRoom: () => ReturnType<typeof usePrivateRoomStore>
          }
          createPrivateRoom: (config: {
            ruleSetId?: string
            battleMode?: 'server' | 'p2p'
            isPrivate?: boolean
            password?: string
            p2pTransport?: 'auto' | 'webrtc' | 'relay'
          }) => Promise<string>
        }
      }
    ).__APP_DEBUG__ = {
      pinia,
      stores: {
        auth: () => useAuthStore(),
        privateRoom: () => usePrivateRoomStore(),
      },
      createPrivateRoom: async config => usePrivateRoomStore().createRoom(config),
    }
  }

  app.mount('#app')
}

void bootstrap().catch(error => {
  console.error('Failed to bootstrap web-ui:', error)
  if (isStaticMode) {
    const container = document.getElementById('app')
    if (!container) return
    const alert = document.createElement('main')
    alert.setAttribute('role', 'alert')
    alert.style.cssText = 'max-width:40rem;margin:12vh auto;padding:2rem;font:1rem/1.6 system-ui'
    const title = document.createElement('h1')
    title.textContent = '无法启动本地对战'
    const message = document.createElement('p')
    message.textContent = '本地游戏资源未完整加载。请重新联网后刷新重试；如果仍然失败，请检查静态文件是否完整。'
    const retry = document.createElement('button')
    retry.type = 'button'
    retry.textContent = '刷新重试'
    retry.style.cssText = 'padding:.6rem 1.2rem;cursor:pointer'
    retry.addEventListener('click', () => window.location.reload())
    alert.append(title, message, retry)
    container.replaceChildren(alert)
  }
})
