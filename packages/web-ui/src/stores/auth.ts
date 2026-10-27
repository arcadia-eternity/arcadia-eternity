import { defineStore } from 'pinia'
import { toRaw } from 'vue'
import type {
  AccountIdentity,
  AccountIntent,
  LocalProfile,
  ServerInfo,
  ServerSession,
} from '@arcadia-eternity/protocol'
import {
  ServerSessionClient,
  clearServerCredentials,
  normalizeSelectedServer,
  normalizeServerUrl,
} from '@/services/serverSession'

const API_BASE_URL = normalizeServerUrl(import.meta.env?.VITE_API_BASE_URL || 'http://localhost:8102/api/v1')
const DEFAULT_SERVER_URL = API_BASE_URL.replace(/\/api\/v1$/, '')
const SERVER_SELECTION_KEY = 'arcadia-selected-server'
const clients = new WeakMap<object, ServerSessionClient>()

function initialSelection(): string | null {
  try {
    const value = sessionStorage.getItem(SERVER_SELECTION_KEY)
    return value ? normalizeSelectedServer(value) : null
  } catch {
    return null
  }
}

export const useAuthStore = defineStore('auth', {
  state: () => {
    const selected = initialSelection()
    return {
      serverUrl: selected ?? DEFAULT_SERVER_URL,
      hasSelectedServer: selected !== null,
      serverGeneration: 0,
      session: null as ServerSession | null,
      serverInfo: null as ServerInfo | null,
      identities: [] as AccountIdentity[],
      invalidationReason: null as string | null,
    }
  },
  getters: {
    isAuthenticated: state => state.session !== null,
    isAccount: state => state.session?.principal.kind === 'account',
  },
  actions: {
    /** Validate the address and storage before disconnecting the active room. */
    checkServerUrl(value: string): string {
      const next = normalizeSelectedServer(value)
      const probe = `${SERVER_SELECTION_KEY}:probe`
      sessionStorage.setItem(probe, next)
      sessionStorage.removeItem(probe)
      return next
    },
    /** Synchronously retire the old authority before any request may use the new address. */
    setServerUrl(value: string): void {
      const next = normalizeSelectedServer(value)
      const previousApi = this.hasSelectedServer ? `${this.serverUrl}/api/v1` : API_BASE_URL
      const nextApi = `${next}/api/v1`
      // Do not alter the active authority if persisting the new selection fails.
      sessionStorage.setItem(SERVER_SELECTION_KEY, next)
      const differentEndpoint = next !== this.serverUrl || previousApi !== nextApi
      if (differentEndpoint || !this.hasSelectedServer) {
        this.serverGeneration++
        const key = toRaw(this.$state)
        const previous = clients.get(key)
        clients.delete(key)
        if (differentEndpoint) {
          // Drop the in-memory credential before touching storage: even a storage failure must fail closed.
          this.session = null
          this.serverInfo = null
          this.identities = []
          this.invalidationReason = null
        }
        this.serverUrl = next
        this.hasSelectedServer = true
        const errors: unknown[] = []
        try {
          previous?.dispose({ preserveCredentials: !differentEndpoint })
        } catch (error) {
          errors.push(error)
        }
        if (differentEndpoint) {
          for (const endpoint of [previousApi, nextApi]) {
            try {
              clearServerCredentials(sessionStorage, endpoint)
            } catch (error) {
              errors.push(error)
            }
          }
        }
        if (errors.length) throw new Error('旧服务器连接已终止，但本地凭据清理失败', { cause: errors[0] })
      }
      this.serverUrl = next
      this.hasSelectedServer = true
    },
    initialize() {
      // Pinia devtools gives each action a new Proxy; the raw state stays stable per store instance.
      const key = toRaw(this.$state)
      if (clients.has(key)) return
      const baseUrl = this.hasSelectedServer ? `${this.serverUrl}/api/v1` : API_BASE_URL
      const generation = this.serverGeneration
      const client = new ServerSessionClient(baseUrl, sessionStorage, fetch, reason => {
        if (clients.get(key) !== client || this.serverGeneration !== generation) return
        this.session = null
        this.identities = []
        this.invalidationReason = reason
        window.dispatchEvent(new CustomEvent('server-session-invalidated', { detail: { reason } }))
      })
      clients.set(key, client)
    },
    async withClient<T>(
      operation: (client: ServerSessionClient) => Promise<T>,
      commit?: (result: T) => void,
    ): Promise<T> {
      this.initialize()
      const key = toRaw(this.$state)
      const client = clients.get(key)
      if (!client) throw new Error('服务器会话未初始化')
      const generation = this.serverGeneration
      const current = () => clients.get(key) === client && this.serverGeneration === generation
      try {
        const result = await operation(client)
        if (!current()) throw new Error('会话操作已取消')
        commit?.(result)
        return result
      } catch (error) {
        if (!current()) throw new Error('会话操作已取消')
        throw error
      } finally {
        if (current()) {
          this.session = client.session
          this.serverInfo = client.info
        }
      }
    },
    async ensureSession(profile: LocalProfile): Promise<ServerSession> {
      return this.withClient(client => client.ensure(profile))
    },
    async refreshAccountContext(): Promise<void> {
      await this.withClient(
        async client => {
          const { session } = await client.refresh()
          return session?.principal.kind === 'account' ? await client.listIdentities() : []
        },
        identities => {
          this.identities = identities
        },
      )
    },
    async loginWithAccount(profile: LocalProfile, proof: unknown): Promise<ServerSession> {
      return this.withClient(client => client.login(profile, proof))
    },
    async requestEmailCode(email: string, intent: AccountIntent) {
      return this.withClient(client => client.requestEmailCode(email, intent))
    },
    async completeEmailCode(challengeId: string, code: string, intent: AccountIntent, profile: LocalProfile) {
      const { result } = await this.withClient(
        async client => {
          const result = await client.completeEmailCode(challengeId, code, intent, profile)
          const identities = Array.isArray(result) ? result : await client.listIdentities()
          return { result, identities }
        },
        value => {
          this.identities = value.identities
        },
      )
      return result
    },
    async startGitHub(intent: AccountIntent): Promise<string> {
      return this.withClient(client => client.startGitHub(intent))
    },
    async completeGitHub(state: string, code: string, profile: LocalProfile) {
      const { result } = await this.withClient(
        async client => {
          const result = await client.completeGitHub(state, code, profile)
          const identities = Array.isArray(result) ? result : await client.listIdentities()
          return { result, identities }
        },
        value => {
          this.identities = value.identities
        },
      )
      return result
    },
    async loadIdentities(): Promise<void> {
      await this.withClient(
        client => client.listIdentities(),
        identities => {
          this.identities = identities
        },
      )
    },
    async unlinkIdentity(identity: AccountIdentity): Promise<void> {
      await this.withClient(
        async client => {
          await client.unlinkIdentity(identity)
          return client.listIdentities()
        },
        identities => {
          this.identities = identities
        },
      )
    },
    async deactivateAccount(): Promise<void> {
      await this.withClient(
        client => client.deactivateAccount(),
        () => {
          this.session = null
          this.identities = []
        },
      )
    },
    async logout(): Promise<void> {
      await this.withClient(
        client => client.logout(),
        () => {
          this.session = null
          this.identities = []
        },
      )
    },
    getAccessToken(expectedGeneration?: number): string | null {
      if (expectedGeneration !== undefined && expectedGeneration !== this.serverGeneration) return null
      return this.session?.token ?? null
    },
  },
})
