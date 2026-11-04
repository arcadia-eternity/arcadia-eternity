import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import MatchmakingPanel from '../MatchmakingPanel.vue'

const mocks = vi.hoisted(() => ({
  rooms: {
    environments: [{ id: 'official', packages: [] }] as Array<{
      id: string
      packages: { name: string; version: string }[]
      executionPolicy?: 'server' | 'peer'
    }>,
    currentRoom: null,
    isSwitchingServer: false,
    refreshEnvironments: vi.fn(),
    prepareMatchmakingEnvironment: vi.fn(),
    cancelMatchmaking: vi.fn(),
  },
  client: {
    currentState: { status: 'connected', matchmaking: 'idle' },
    serverUrl: 'http://localhost',
    on: vi.fn(),
    off: vi.fn(),
  },
}))
vi.mock('@/stores/privateRoom', () => ({ usePrivateRoomStore: () => mocks.rooms }))
vi.mock('@/stores/battleClient', () => ({ useBattleClientStore: () => mocks.client }))
vi.mock('@/stores/petStorage', () => ({ usePetStorageStore: () => ({ teams: [], getLastMatchingConfig: () => null }) }))
const stubs = {
  ElButton: { props: ['disabled'], template: '<button :disabled="disabled"><slot /></button>' },
  ElDialog: {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template:
      '<div v-if="modelValue"><button data-testid="dismiss" @click="$emit(\'update:modelValue\', false)" /><slot /><slot name="footer" /></div>',
  },
  ElSelect: { template: '<div><slot /></div>' },
  ElOption: { props: ['label'], template: '<span>{{ label }}</span>' },
  TeamSelector: true,
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.rooms.environments = [{ id: 'official', packages: [] }]
  mocks.rooms.cancelMatchmaking.mockResolvedValue(undefined)
})

it('offers peer matchmaking and waits for fixed execution materials before readiness', async () => {
  mocks.rooms.environments = [
    { id: 'peer-env', packages: [{ name: '@community/game', version: '1.0.0' }], executionPolicy: 'peer' },
  ]
  mocks.rooms.refreshEnvironments.mockResolvedValueOnce(undefined)
  let finish!: () => void
  mocks.rooms.prepareMatchmakingEnvironment.mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        finish = resolve
      }),
  )
  const panel = mount(MatchmakingPanel, { global: { stubs } })
  await panel.get('[data-testid="open-matchmaking-button"]').trigger('click')
  await flushPromises()
  expect(mocks.rooms.prepareMatchmakingEnvironment).toHaveBeenCalledWith('peer-env')
  expect(panel.text()).toContain('@community/game 1.0.0 · 玩家主机')
  expect(panel.text()).toContain('固定内容与执行材料准备完成后才能匹配')
  expect(panel.get('[data-testid="start-matchmaking-button"]').attributes('disabled')).toBeDefined()
  finish()
  await flushPromises()
  panel.unmount()
})
afterEach(() => vi.restoreAllMocks())
it.each(['close', 'unmount'])(
  'does not start a late content preparation after %s while loading the catalog',
  async action => {
    let finish!: () => void
    mocks.rooms.refreshEnvironments.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          finish = resolve
        }),
    )
    const panel = mount(MatchmakingPanel, { global: { stubs } })
    await panel.get('[data-testid="open-matchmaking-button"]').trigger('click')
    if (action === 'close') await panel.get('[data-testid="dismiss"]').trigger('click')
    else panel.unmount()
    finish()
    await flushPromises()
    expect(mocks.rooms.prepareMatchmakingEnvironment).not.toHaveBeenCalled()
    if (action === 'close') panel.unmount()
  },
)

it('invalidates store preparation when unmounted while content is loading', async () => {
  let finish!: () => void
  mocks.rooms.refreshEnvironments.mockResolvedValueOnce(undefined)
  mocks.rooms.prepareMatchmakingEnvironment.mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        finish = resolve
      }),
  )
  const panel = mount(MatchmakingPanel, { global: { stubs } })
  await panel.get('[data-testid="open-matchmaking-button"]').trigger('click')
  await flushPromises()
  expect(mocks.rooms.prepareMatchmakingEnvironment).toHaveBeenCalledOnce()
  panel.unmount()
  expect(mocks.rooms.cancelMatchmaking).toHaveBeenCalledOnce()
  finish()
  await flushPromises()
})
