import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import ServerSettingsForm from '../ServerSettingsForm.vue'
import type { ManagedServerSettings } from '@/types/management'

const settings = (): ManagedServerSettings => ({
  host: '127.0.0.1',
  port: 8102,
  publicOrigin: 'https://play.example.com',
  corsOrigins: ['https://play.example.com'],
  battleCapacity: { maxConcurrentBattles: 32, maxIdleWorkers: 4, maxQueuedBattles: 64, battleQueueTimeoutMs: 5000 },
})
const pages: VueWrapper[] = []
const button = (page: VueWrapper, text: string) => page.findAll('button').find(item => item.text() === text)!
function open(extra: Record<string, unknown> = {}) {
  const source = reactive(settings())
  const page = mount(ServerSettingsForm, {
    props: { settings: source, revision: 12, busy: false, canEdit: true, ...extra },
  })
  pages.push(page)
  return { page, source }
}
afterEach(() => pages.splice(0).forEach(page => page.unmount()))

describe('server settings editor', () => {
  it('captures the revision at edit time and does not mutate the reactive source while editing', async () => {
    const { page, source } = open()
    await button(page, '编辑设置').trigger('click')
    await page.get('select').setValue('network')
    await page.get('input[name=port]').setValue('9100')
    await page.get('input[name=publicOrigin]').setValue('')
    await page.get('input[name=maxConcurrentBattles]').setValue('24')
    await page.get('textarea').setValue(' https://one.example \n\nhttps://two.example')
    await page.setProps({ revision: 13, settings: { ...settings(), port: 8200 } })
    await page.get('form').trigger('submit')
    const [saved, revision] = page.emitted('save')![0]! as [
      Omit<ManagedServerSettings, 'publicOrigin'> & { publicOrigin: null },
      number,
    ]
    expect(revision).toBe(12)
    expect(saved).toMatchObject({
      host: '0.0.0.0',
      port: 9100,
      publicOrigin: null,
      corsOrigins: ['https://one.example', 'https://two.example'],
      battleCapacity: { maxConcurrentBattles: 24, maxIdleWorkers: 4 },
    })
    expect(source.host).toBe('127.0.0.1')
    expect(source.port).toBe(8102)
    expect(source.battleCapacity.maxConcurrentBattles).toBe(32)
  })

  it('shows effective runtime values separately from desired values pending restart', () => {
    const desired = settings()
    desired.port = 9100
    desired.battleCapacity.maxConcurrentBattles = 24
    const { page } = open({
      settings: desired,
      runtimeSettings: settings(),
      pendingRestart: ['port', 'battleCapacity'],
    })
    expect(page.get('[role="status"]').text()).toContain('重启服务器后应用')
    expect(page.text()).toContain('当前监听 127.0.0.1:8102')
    expect(page.findAll('dd')[0]!.text()).toMatch(/32\s*→ 24（待重启）/)
    expect(page.text()).not.toContain('当前监听 127.0.0.1:9100')
  })

  it('retains edits until a successful acknowledgement and then reopens against the new revision', async () => {
    const { page } = open({ saveSequence: 0 })
    await button(page, '编辑设置').trigger('click')
    await page.get('input[name=port]').setValue('9100')
    await page.get('form').trigger('submit')
    await page.setProps({ busy: false, revision: 13 })
    expect(page.find('form').exists()).toBe(true)
    expect((page.get('input[name=port]').element as HTMLInputElement).value).toBe('9100')
    await page.setProps({ saveSequence: 1, settings: { ...settings(), port: 9100 } })
    expect(page.find('form').exists()).toBe(false)
    await button(page, '编辑设置').trigger('click')
    await page.get('input[name=port]').setValue('9200')
    await page.get('form').trigger('submit')
    expect(page.emitted('save')![1]![1]).toBe(13)
    expect((page.emitted('save')![1]![0] as ManagedServerSettings).port).toBe(9200)
  })

  it('disables editing without settings permission and disables submission if permission is withdrawn', async () => {
    const { page } = open({ canEdit: false })
    expect(button(page, '编辑设置').attributes('disabled')).toBeDefined()
    await button(page, '编辑设置').trigger('click')
    expect(page.find('form').exists()).toBe(false)
    await page.setProps({ canEdit: true })
    await button(page, '编辑设置').trigger('click')
    await page.setProps({ canEdit: false })
    expect(button(page, '保存下次启动设置').attributes('disabled')).toBeDefined()
    await button(page, '保存下次启动设置').trigger('click')
    expect(page.emitted('save')).toBeUndefined()
  })
})
