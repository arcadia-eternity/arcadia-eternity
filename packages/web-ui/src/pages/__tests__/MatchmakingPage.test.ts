import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent } from 'vue'
import { useMatchmakingStore } from '@/stores/matchmaking'
import MatchmakingPage from '../MatchmakingPage.vue'

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
    cancelMatchmakingPreparation: vi.fn(),
    joinMatchmaking: vi.fn(),
  },
  client: {
    currentState: { status: 'connected', matchmaking: 'idle' },
    isConnected: true,
    serverUrl: 'http://localhost',
    on: vi.fn(),
  },
}))
vi.mock('@/stores/privateRoom', () => ({ usePrivateRoomStore: () => mocks.rooms }))
vi.mock('@/stores/battleClient', () => ({ useBattleClientStore: () => mocks.client }))
vi.mock('@/stores/gameData', () => ({
  useGameDataStore: () => ({ applyServerEnvironment: vi.fn(), clearServerEnvironment: vi.fn() }),
}))
vi.mock('@/stores/petStorage', () => ({
  usePetStorageStore: () => ({
    teams: [{ name: '测试队伍', pets: [] }],
    currentTeamIndex: 0,
    getLastMatchingConfig: () => null,
    saveLastMatchingConfig: vi.fn(),
  }),
}))
const prepared = { content: { species: [], skills: [], marks: [] } }
const stubs = {
  ElButton: { props: ['disabled'], template: '<button :disabled="disabled"><slot /></button>' },
  RouterLink: { template: '<a><slot /></a>' },
  ElSelect: { template: '<div><slot /></div>' },
  ElOption: { props: ['label'], template: '<span>{{ label }}</span>' },
  TeamSelector: defineComponent({
    emits: ['update:isValid'],
    mounted() {
      this.$emit('update:isValid', true)
    },
    template: '<div />',
  }),
}
beforeEach(() => {
  vi.resetAllMocks()
  setActivePinia(createPinia())
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
      new Promise(resolve => {
        finish = () => resolve(prepared)
      }),
  )
  const panel = mount(MatchmakingPage, { global: { stubs } })
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
it('does not start a late content preparation after leaving while loading the catalog', async () => {
  let finish!: () => void
  mocks.rooms.refreshEnvironments.mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        finish = resolve
      }),
  )
  const panel = mount(MatchmakingPage, { global: { stubs } })
  panel.unmount()
  finish()
  await flushPromises()
  expect(mocks.rooms.prepareMatchmakingEnvironment).not.toHaveBeenCalled()
})

it('invalidates store preparation when unmounted while content is loading', async () => {
  let finish!: () => void
  mocks.rooms.refreshEnvironments.mockResolvedValueOnce(undefined)
  mocks.rooms.prepareMatchmakingEnvironment.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = () => resolve(prepared)
      }),
  )
  const panel = mount(MatchmakingPage, { global: { stubs } })
  await flushPromises()
  expect(mocks.rooms.prepareMatchmakingEnvironment).toHaveBeenCalledOnce()
  panel.unmount()
  expect(mocks.rooms.cancelMatchmakingPreparation).toHaveBeenCalledOnce()
  expect(mocks.rooms.cancelMatchmaking).not.toHaveBeenCalled()
  finish()
  await flushPromises()
})

it('keeps joining after leaving the page and supports cancellation while preparation is pending', async () => {
  mocks.rooms.prepareMatchmakingEnvironment.mockResolvedValueOnce(prepared)
  let finish!: () => void
  mocks.rooms.joinMatchmaking.mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        finish = resolve
      }),
  )
  const panel = mount(MatchmakingPage, { global: { stubs } })
  await flushPromises()
  await panel.get('[data-testid="start-matchmaking-button"]').trigger('click')
  const matchmaking = useMatchmakingStore()
  expect(matchmaking.waiting).toBe(true)
  panel.unmount()
  expect(matchmaking.waiting).toBe(true)
  expect(mocks.rooms.cancelMatchmaking).not.toHaveBeenCalled()

  await matchmaking.cancel()
  expect(mocks.rooms.cancelMatchmaking).toHaveBeenCalledOnce()
  expect(matchmaking.waiting).toBe(false)
  finish()
  await flushPromises()
  expect(matchmaking.waiting).toBe(false)
})
