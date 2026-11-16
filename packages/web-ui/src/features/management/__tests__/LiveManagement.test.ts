import { describe, expect, it } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import LiveManagement from '../LiveManagement.vue'
import type { ManagedBattle } from '@/types/management'
const battle = (id: string, execution: 'server' | 'peer' = 'server'): ManagedBattle => ({
  id,
  roomCode: id,
  environmentId: 'friends',
  environmentName: '好友环境',
  bindingId: 'friends-binding',
  installationId: 'version-at-start',
  startedAt: Date.now() - 120000,
  execution,
  state: 'running',
  players: [{ seatId: 'seat-a', name: '玩家 A', connected: true }],
})
const props = {
  mode: 'battles' as const,
  battles: [battle('match-one'), battle('match-two', 'peer')],
  players: [],
  accounts: [],
  canReadPlayers: true,
  canReadBattles: true,
  canManageAccounts: true,
  canTerminate: true,
  moreAccounts: false,
  busy: false,
}
describe('live server operations', () => {
  it('keeps termination tied to the selected ID, confirms without text input and handles a completed match', async () => {
    const page = mount(LiveManagement, { props })
    await flushPromises()
    await page
      .findAll('button')
      .find(button => button.text() === '查看对战')!
      .trigger('click')
    expect(page.get('[aria-label="对战详情"]').text()).toContain('version-at-start')
    await flushPromises()
    await page
      .findAll('button')
      .find(button => button.text() === '终止此对战')!
      .trigger('click')
    await page.setProps({ battles: [battle('match-two', 'peer'), battle('match-one')] })
    const form = page.get('[aria-label="确认管理操作"]')
    expect(form.find('button').attributes('disabled')).toBeUndefined()
    expect(form.find('textarea, input').exists()).toBe(false)
    await form.trigger('submit')
    expect(page.emitted('terminate')).toEqual([['match-one']])
    await page.setProps({ battles: [battle('match-two', 'peer')] })
    expect(page.get('[aria-label="对战详情"]').text()).toContain('此对战已结束')
    page.unmount()
  })
  it('does not offer remote execution control for peer matches or viewers', async () => {
    for (const input of [{ battles: [battle('peer', 'peer')] }, { battles: [battle('server')], canTerminate: false }]) {
      const page = mount(LiveManagement, { props: { ...props, ...input } })
      await flushPromises()
      await page
        .findAll('button')
        .find(button => button.text() === '查看对战')!
        .trigger('click')
      expect(page.findAll('button').some(button => button.text() === '终止此对战')).toBe(false)
      page.unmount()
    }
  })
  it('links guests to battles without inventing an account, and searches across environments', async () => {
    const page = mount(LiveManagement, {
      props: {
        ...props,
        mode: 'accounts',
        players: [
          {
            seatId: 'guest-seat',
            name: '访客 A',
            kind: 'guest',
            connected: true,
            battleId: 'match-one',
          },
        ],
      },
    })
    await flushPromises()
    expect(page.text()).toContain('访客 A')
    expect(page.findAll('button').some(button => button.text() === '停用账户')).toBe(false)
    await flushPromises()
    await page
      .findAll('button')
      .find(button => button.text() === '查看对战')!
      .trigger('click')
    expect(page.get('[aria-label="对战详情"]').text()).toContain('match-one')
    await page.get('input[type=search]').setValue('不存在')
    expect(page.text()).toContain('无匹配会话')
    expect(page.text()).not.toContain('访客 A')
    page.unmount()
  })
})
