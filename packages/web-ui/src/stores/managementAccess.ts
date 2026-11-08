import { defineStore } from 'pinia'
import { createHttpManagementClient } from '@/services/managementClient'
import { restoreManagementSession } from '@/services/managementSession'
import type { ManagementCapabilities } from '@/types/management'

export const useManagementAccessStore = defineStore('management-access', {
  state: () => ({ allowed: false, endpoint: '', generation: 0 }),
  actions: {
    async check(endpoint: string, accountProof?: string) {
      const generation = ++this.generation
      this.allowed = false
      this.endpoint = endpoint
      const client = createHttpManagementClient({ transport: 'http', endpoint, label: '服务器' })
      try {
        await restoreManagementSession(client, accountProof)
        const capabilities = await client.request<ManagementCapabilities>('GET', '/capabilities')
        if (generation === this.generation)
          this.allowed = capabilities.effectivePermissions.some(item => item.actions.length > 0)
      } catch {
        /* Unknown identity never exposes the main navigation entry. */
      }
    },
  },
})
