import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ManagementGrantEditor from '../ManagementGrantEditor.vue'
import type { ManagementGrant } from '@/types/management'
const grant: ManagementGrant = {
  id: 'grant-1',
  revision: 4,
  principalId: 'admin',
  scope: { kind: 'workspace', id: 'workspace-1' },
  actions: ['read'],
}
describe('management grant editing', () => {
  it('edits actions while preserving the subject, scope and concurrency revision', async () => {
    const page = mount(ManagementGrantEditor, {
      props: { grant, busy: false, allowedActions: ['read', 'edit', 'grants.manage'] },
    })
    await page.get('button').trigger('click')
    await page.get('input[value="edit"]').setValue(true)
    expect(page.get('input[value="prepare"]').attributes('disabled')).toBeDefined()
    await page
      .findAll('button')
      .find(button => button.text() === '保存权限')!
      .trigger('click')
    expect(page.emitted('save')).toEqual([[grant, ['read', 'edit']]])
    page.unmount()
  })
  it('blocks stale edits after another administrator updates a grant', async () => {
    const page = mount(ManagementGrantEditor, {
      props: { grant, busy: false, allowedActions: ['read', 'edit', 'grants.manage'] },
    })
    await page.get('button').trigger('click')
    await page.setProps({ grant: { ...grant, revision: 5, actions: ['read', 'prepare'] } })
    expect(page.get('[role="alert"]').text()).toContain('授权已变更')
    expect(
      page
        .findAll('button')
        .find(button => button.text() === '保存权限')!
        .attributes('disabled'),
    ).toBeDefined()
    expect(page.emitted('save')).toBeUndefined()
    page.unmount()
  })
})
