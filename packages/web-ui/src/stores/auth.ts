import { defineStore } from 'pinia'
import type { LocalProfile, ServerInfo, ServerSession } from '@arcadia-eternity/protocol'
import { ServerSessionClient } from '@/services/serverSession'

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || 'http://localhost:8102/api/v1'
let client: ServerSessionClient | null = null

export const useAuthStore = defineStore('auth', {
  state: () => ({
    session: null as ServerSession | null,
    serverInfo: null as ServerInfo | null,
    invalidationReason: null as string | null,
  }),
  getters: {
    isAuthenticated: state => state.session !== null,
    isAccount: state => state.session?.principal.kind === 'account',
  },
  actions: {
    initialize() {
      if (client) return
      client = new ServerSessionClient(API_BASE_URL, sessionStorage, fetch, reason => {
        this.session = null
        this.invalidationReason = reason
        window.dispatchEvent(new CustomEvent('server-session-invalidated', { detail: { reason } }))
      })
    },
    async ensureSession(profile: LocalProfile): Promise<ServerSession> {
      this.initialize()
      try {
        const session = await client!.ensure(profile)
        this.session = session
        return session
      } finally {
        this.session = client!.session
        this.serverInfo = client!.info
      }
    },
    async loginWithAccount(profile: LocalProfile, proof: unknown): Promise<ServerSession> {
      this.initialize()
      try {
        this.session = await client!.login(profile, proof)
        return this.session
      } finally {
        this.session = client!.session
        this.serverInfo = client!.info
      }
    },
    async logout() {
      this.initialize()
      await client!.logout()
      this.session = null
    },
    getAccessToken(): string | null {
      return this.session?.token ?? null
    },
  },
})
