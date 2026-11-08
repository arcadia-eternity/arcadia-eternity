import { ElSelect, ElOption } from 'element-plus'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import ManagementCredentials from '../ManagementCredentials.vue'
import type { ManagementCapabilities } from '@/types/management'

const capabilities = (actions = ['read', 'grants.manage']): ManagementCapabilities => ({
  serverId: 'server-a',
  workspaceId: 'workspace-a',
  supportedFeatures: ['grants'],
  effectivePermissions: [{ scope: { kind: 'server', id: 'server-a' }, actions }],
  resourceRestrictions: [],
})
const token = 'ae_mgt_private-token-for-test'
const issued = { token, credentialId: 'credential-a', expiresAt: 1794000000000 }
const pages: VueWrapper[] = []
const button = (page: VueWrapper, text: string) => page.findAll('button').find(item => item.text() === text)!
function open(extra: Record<string, unknown> = {}) {
  const page = mount(ManagementCredentials, { props: { capabilities: capabilities(), busy: false, ...extra } })
  pages.push(page)
  return page
}
afterEach(() => {
  pages.splice(0).forEach(page => page.unmount())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('management service credentials', () => {
  it('can revoke a credential restored from server metadata after reopening the page', async () => {
    const page = open({
      credentials: [
        {
          id: 'restored-id',
          principalId: 'owner',
          createdAt: 1,
          expiresAt: 1794000000000,
          permissions: [{ scope: { kind: 'server', id: 'server-a' }, actions: ['read'] }],
        },
      ],
    })
    expect(page.find('[aria-label="新签发的凭证"]').exists()).toBe(false)
    expect(page.get('[aria-label="已有服务凭证"]').text()).toContain('restored-id')
    await page.get('[aria-label="已有服务凭证"] button').trigger('click')
    await button(page, '确认撤销').trigger('click')
    expect(page.emitted('revoke')).toEqual([['restored-id']])
  })
  it('defaults to a24-hour read-only credential in the authorized current scope', async () => {
    const now = 1793808000000
    vi.spyOn(Date, 'now').mockReturnValue(now)
    const page = open()
    await page.get('[aria-label="签发管理凭证"]').trigger('submit')
    expect(page.emitted('issue')).toEqual([
      [
        {
          permissions: [{ scope: { kind: 'server', id: 'server-a' }, actions: ['read'] }],
          expiresAt: now + 24 * 60 * 60 * 1000,
        },
      ],
    ])
    expect(page.findAllComponents(ElOption).some(option => option.props('label') === '服务器管理员')).toBe(false)
  })

  it('never exposes ungranted actions or scopes, and removes withdrawn selections before issue', async () => {
    const cap = capabilities(['read', 'publish', 'grants.manage'])
    cap.effectivePermissions.push(
      { scope: { kind: 'workspace', id: 'workspace-a' }, actions: ['read', 'edit'] },
      { scope: { kind: 'server', id: 'other-server' }, actions: ['*'] },
    )
    const page = open({ capabilities: cap })
    expect(page.findAll('input[type="checkbox"]').map(input => input.element.getAttribute('value'))).toEqual([
      'read',
      'publish',
      'grants.manage',
    ])
    expect(page.findAllComponents(ElSelect)[0]!.findAllComponents(ElOption)).toHaveLength(1)
    await page.get('input[value="publish"]').setValue(true)
    await page.setProps({ capabilities: capabilities(['read', 'grants.manage']) })
    expect(page.find('input[value="publish"]').exists()).toBe(false)
    await page.get('[aria-label="签发管理凭证"]').trigger('submit')
    const payload = page.emitted('issue')![0]![0] as { permissions: { actions: string[] }[] }
    expect(payload.permissions[0]!.actions).toEqual(['read'])
  })

  it('expands explicit administrator presets from wildcard grants without emitting wildcard permissions', async () => {
    const cap = capabilities(['*'])
    cap.effectivePermissions.push({ scope: { kind: 'workspace', id: 'workspace-a' }, actions: ['*'] })
    const page = open({ capabilities: cap })
    const selects = page.findAllComponents(ElSelect)
    await selects[0]!.setValue('workspace')
    await selects[1]!.setValue('admin')
    selects[1]!.vm.$emit('change', 'admin')
    await page.get('input[maxlength="128"]').setValue(' automation-principal ')
    await page.get('[aria-label="签发管理凭证"]').trigger('submit')
    const payload = page.emitted('issue')![0]![0] as {
      principalId: string
      permissions: { scope: { kind: string; id: string }; actions: string[] }[]
    }
    expect(payload.principalId).toBe('automation-principal')
    expect(payload.permissions[0]!.scope).toEqual({ kind: 'workspace', id: 'workspace-a' })
    expect(payload.permissions[0]!.actions).toEqual([
      'read',
      'environment.use',
      'edit',
      'prepare',
      'delete',
      'export',
      'grants.manage',
    ])
    expect(payload.permissions[0]!.actions).not.toContain('*')
  })

  it('requires grants.manage to issue and rejects an invalid expiry even through direct form submission', async () => {
    const readonly = open({ capabilities: capabilities(['read']) })
    expect(readonly.find('[aria-label="签发管理凭证"]').exists()).toBe(false)
    const page = open()
    await page.get('input[type="number"]').setValue('721')
    await page.get('[aria-label="签发管理凭证"]').trigger('submit')
    expect(page.emitted('issue')).toBeUndefined()
    expect(page.get('[role="alert"]').text()).toContain('1 至 720')
    await page.get('input[type="number"]').setValue('24')
    for (const input of page.findAll('input[type="checkbox"]')) await input.setValue(false)
    await page.get('[aria-label="签发管理凭证"]').trigger('submit')
    expect(page.emitted('issue')).toBeUndefined()
  })

  it('copies only explicitly, never persists a token, and removes it immediately when dismissed or cleared by parent', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const persist = vi.spyOn(Storage.prototype, 'setItem')
    const page = open({ issued })
    expect(page.get('[aria-label="新签发的凭证"] input').attributes('type')).toBe('password')
    expect(writeText).not.toHaveBeenCalled()
    await button(page, '复制凭证').trigger('click')
    expect(writeText).toHaveBeenCalledWith(token)
    expect(persist).not.toHaveBeenCalled()
    await button(page, '已保存，关闭').trigger('click')
    expect(page.emitted('dismiss')).toHaveLength(1)
    expect(page.find('[aria-label="新签发的凭证"]').exists()).toBe(false)
    await page.setProps({ issued: { ...issued, credentialId: 'credential-b', token: 'new-token' } })
    expect((page.get('[aria-label="新签发的凭证"] input').element as HTMLInputElement).value).toBe('new-token')
    await page.setProps({ issued: undefined })
    expect(page.find('[aria-label="新签发的凭证"]').exists()).toBe(false)
    expect(persist).not.toHaveBeenCalled()
  })

  it('requires confirmation for quick and manual revocation and captures the intended credential ID', async () => {
    const page = open({ issued })
    await button(page, '撤销此凭证').trigger('click')
    expect(page.emitted('revoke')).toBeUndefined()
    await button(page, '取消').trigger('click')
    expect(page.emitted('revoke')).toBeUndefined()
    await page.get('[aria-label="撤销管理凭证"] input').setValue('credential-other')
    await page.get('[aria-label="撤销管理凭证"]').trigger('submit')
    await page.get('[aria-label="撤销管理凭证"] input').setValue('credential-changed')
    await button(page, '确认撤销').trigger('click')
    expect(page.emitted('revoke')).toEqual([['credential-other']])
    await button(page, '撤销此凭证').trigger('click')
    await button(page, '确认撤销').trigger('click')
    expect(page.emitted('revoke')![1]).toEqual(['credential-a'])
  })
})
