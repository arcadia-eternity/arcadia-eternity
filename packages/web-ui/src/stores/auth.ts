import { defineStore } from 'pinia'
import type {
  AccountIdentity,
  AccountIntent,
  LocalProfile,
  ServerInfo,
  ServerSession,
} from '@arcadia-eternity/protocol'
import { ServerSessionClient } from '@/services/serverSession'

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || 'http://localhost:8102/api/v1'
let client: ServerSessionClient | null = null

export const useAuthStore = defineStore('auth', {
  state: () => ({
    session: null as ServerSession | null,
    serverInfo: null as ServerInfo | null,
    identities: [] as AccountIdentity[],
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
        this.identities = []
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
    async refreshAccountContext(): Promise<void> {
      this.initialize()
      try {
        const { info, session } = await client!.refresh()
        this.serverInfo = info
        this.session = session
        this.identities = session?.principal.kind === 'account' ? await client!.listIdentities() : []
      } finally {
        this.serverInfo = client!.info
        this.session = client!.session
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
    async requestEmailCode(email: string, intent: AccountIntent) {
      this.initialize()
      return client!.requestEmailCode(email, intent)
    },
    async completeEmailCode(challengeId: string, code: string, intent: AccountIntent, profile: LocalProfile) {
      this.initialize()
      try {
        const result = await client!.completeEmailCode(challengeId, code, intent, profile)
        if (Array.isArray(result)) this.identities = result
        else {
          this.session = result
          this.identities = await client!.listIdentities()
        }
        return result
      } finally {
        this.session = client!.session
        this.serverInfo = client!.info
      }
    },
    async startGitHub(intent: AccountIntent): Promise<string> {
      this.initialize()
      return client!.startGitHub(intent)
    },
    async completeGitHub(state: string, code: string, profile: LocalProfile) {
      this.initialize()
      try {
        const result = await client!.completeGitHub(state, code, profile)
        if (Array.isArray(result)) this.identities = result
        else {
          this.session = result
          this.identities = await client!.listIdentities()
        }
        return result
      } finally {
        this.session = client!.session
        this.serverInfo = client!.info
      }
    },
    async loadIdentities(): Promise<void> {
      this.initialize()
      this.identities = await client!.listIdentities()
    },
    async unlinkIdentity(identity: AccountIdentity): Promise<void> {
      this.initialize()
      await client!.unlinkIdentity(identity)
      this.identities = await client!.listIdentities()
    },
    async deactivateAccount(): Promise<void> {
      this.initialize()
      await client!.deactivateAccount()
      this.session = null
      this.identities = []
    },
    async logout() {
      this.initialize()
      await client!.logout()
      this.session = null
      this.identities = []
    },
    getAccessToken(): string | null {
      return this.session?.token ?? null
    },
  },
})
