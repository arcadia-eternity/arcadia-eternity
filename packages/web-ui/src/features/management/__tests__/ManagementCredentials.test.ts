import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ManagementCredentials from '../ManagementCredentials.vue'
describe('administrator automation credentials', () => {
  it('issues one server-wide credential without role, scope or action selectors', async () => {
    const page = mount(ManagementCredentials, { props: { busy: false } })
    await page.get('form').trigger('submit')
    const input = page.emitted('issue')![0]![0] as { expiresAt: number }
    expect(Object.keys(input)).toEqual(['expiresAt'])
    expect(input.expiresAt).toBeGreaterThan(Date.now())
    expect(page.text()).toContain('凭据拥有本服完整管理权')
    expect(page.find('input[type="checkbox"]').exists()).toBe(false)
    page.unmount()
  })
  it('shows the issued secret once and revokes an existing token by public id', async () => {
    const page = mount(ManagementCredentials, {
      props: {
        busy: false,
        issued: { token: 'secret', credentialId: 'token-1', expiresAt: Date.now() + 60000 },
        credentials: [
          {
            id: 'token-1',
            principalId: 'owner',
            serverId: 'server',
            createdAt: Date.now(),
            expiresAt: Date.now() + 60000,
            legacyRestricted: true,
          },
        ],
      },
    })
    expect((page.get('input[type="password"]').element as HTMLInputElement).value).toBe('secret')
    const click = async (text: string) =>
      page
        .findAll('button')
        .find(button => button.text() === text)!
        .trigger('click')
    await click('已保存，关闭')
    expect(page.emitted('dismiss')).toHaveLength(1)
    await click('撤销凭据')
    expect(page.emitted('revoke')).toBeUndefined()
    await click('确认撤销')
    expect(page.emitted('revoke')).toEqual([['token-1']])
    page.unmount()
  })
})
