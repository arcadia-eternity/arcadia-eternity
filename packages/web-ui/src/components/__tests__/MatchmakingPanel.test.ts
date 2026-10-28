import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import MatchmakingPanel from '../MatchmakingPanel.vue'

const mocks = vi.hoisted(() => ({
  rooms: {
    environments: [{ id: 'official', packages: [] }],
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
  ElOption: true,
  TeamSelector: true,
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.rooms.cancelMatchmaking.mockResolvedValue(undefined)
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
