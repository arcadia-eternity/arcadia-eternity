import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import LobbyPage from '../lobbyPage.vue'

const deployment = vi.hoisted(() => ({ desktop: false, authorize: vi.fn() }))
vi.mock('@/bootstrap/deployment', () => ({
  canSelectBackend: () => deployment.desktop,
  authorizeLocalBackend: deployment.authorize,
}))
const remotePlay = vi.fn()
const push = vi.fn()
const refreshEnvironments = vi.fn()
const createRoom = vi.fn()
const switchServer = vi.fn()
const confirmSwitch = vi.fn()
let battleClient: { currentState: { status: string }; serverUrl: string }
let privateRoom: {
  currentRoom: { status: string; config: { roomCode: string } } | null
  isSwitchingServer: boolean
  environments: Array<{ id: string; packages: { name: string; version: string }[] }>
  refreshEnvironments: typeof refreshEnvironments
  createRoom: typeof createRoom
  switchServer: typeof switchServer
}
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/stores/privateRoom', () => ({ usePrivateRoomStore: () => privateRoom }))
vi.mock('@/stores/battleClient', () => ({ useBattleClientStore: () => battleClient }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ invalidationReason: null }) }))
vi.mock('@/utils/env', () => ({ isDesktop: false }))
vi.mock('element-plus', () => ({
  ElMessage: { error: vi.fn(), success: vi.fn() },
  ElMessageBox: { confirm: (...args: unknown[]) => confirmSwitch(...args) },
}))

const stubs = {
  MatchmakingPanel: true,
  RouterLink: { template: '<a><slot /></a>' },
  ElIcon: { template: '<i><slot /></i>' },
  ElButton: {
    props: ['disabled'],
    emits: ['click'],
    template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
  },
  ElDialog: { props: ['modelValue'], template: '<div v-if="modelValue"><slot /><slot name="footer" /></div>' },
  ElForm: { template: '<div><slot /></div>' },
  ElFormItem: { template: '<label><slot /></label>' },
  ElSelect: {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template:
      '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><slot /></select>',
  },
  ElOption: { props: ['label', 'value'], template: '<option :value="value">{{ label }}</option>' },
  ElInput: {
    props: ['modelValue', 'disabled'],
    emits: ['update:modelValue'],
    template:
      '<input :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
  ElAlert: { template: '<div><slot /></div>' },
  RoomBattleOptions: {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template:
      '<button data-testid="p2p" @click="$emit(\'update:modelValue\', { ...modelValue, battleMode: \'p2p\' })">P2P</button>',
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  deployment.desktop = false
  remotePlay.mockReset().mockResolvedValue(undefined)
  battleClient = reactive({ currentState: { status: 'connected' }, serverUrl: 'http://localhost:8102' })
  privateRoom = reactive({
    currentRoom: null,
    isSwitchingServer: false,
    environments: [],
    refreshEnvironments,
    createRoom,
    switchServer,
  })
  switchServer.mockReset().mockResolvedValue(undefined)
  confirmSwitch.mockReset().mockResolvedValue('confirm')
  refreshEnvironments.mockImplementation(async () => {
    privateRoom.environments = [
      { id: 'official', packages: [] },
      { id: 'ugc', packages: [{ name: '@example/slow', version: '1.0.0' }] },
    ]
  })
  createRoom.mockResolvedValue('ABC123')
})
afterEach(() => vi.unstubAllGlobals())

it('loads the current server catalog and submits the selected content when creating a server room', async () => {
  const page = mount(LobbyPage, { global: { stubs } })
  await page.get('[data-testid="create-private-room-button"]').trigger('click')
  await flushPromises()
  expect(refreshEnvironments).toHaveBeenCalledOnce()
  const select = page.get('[data-testid="room-environment-select"]')
  expect(select.text()).toContain('@example/slow 1.0.0')
  await select.setValue('ugc')
  await page.get('[data-testid="confirm-create-private-room-button"]').trigger('click')
  await flushPromises()
  expect(createRoom).toHaveBeenCalledWith(expect.objectContaining({ battleMode: 'server' }), 'ugc')
  expect(push).toHaveBeenCalledWith('/room/ABC123')
})

it('keeps official room creation available when the server catalog is unavailable and never sends custom content for P2P', async () => {
  refreshEnvironments.mockRejectedValueOnce(new Error('offline'))
  const page = mount(LobbyPage, { global: { stubs } })
  await page.get('[data-testid="create-private-room-button"]').trigger('click')
  await flushPromises()
  expect(page.text()).toContain('内容列表暂不可用')
  await page.get('[data-testid="confirm-create-private-room-button"]').trigger('click')
  await flushPromises()
  expect(createRoom).toHaveBeenLastCalledWith(expect.objectContaining({ battleMode: 'server' }), undefined)
  await page.get('[data-testid="create-private-room-button"]').trigger('click')
  await flushPromises()
  await page.get('[data-testid="room-environment-select"]').setValue('ugc')
  await page.get('[data-testid="p2p"]').trigger('click')
  expect(page.find('[data-testid="room-environment-select"]').exists()).toBe(false)
  await page.get('[data-testid="confirm-create-private-room-button"]').trigger('click')
  await flushPromises()
  expect(createRoom).toHaveBeenLastCalledWith(expect.objectContaining({ battleMode: 'p2p' }), undefined)
})

it('browser displays its paired server without a server selection or local-host entry', () => {
  const page = mount(LobbyPage, { global: { stubs } })
  expect(page.get('[data-testid="current-server-address"]').text()).toBe('http://localhost:8102')
  expect(page.find('[data-testid="server-address-input"]').exists()).toBe(false)
  expect(page.find('[data-testid="start-local-server-button"]').exists()).toBe(false)
})

it('desktop opens any typed server in an isolated window, shows failures and permits retry', async () => {
  deployment.desktop = true
  vi.stubGlobal('arcadiaDesktop', { openRemotePlay: remotePlay })
  remotePlay.mockRejectedValueOnce(new Error('无法连接服务器'))
  const page = mount(LobbyPage, { global: { stubs } })
  await page.get('[data-testid="server-address-input"]').setValue('http://127.0.0.1:9999')
  await page.get('[data-testid="connect-server-button"]').trigger('click')
  await flushPromises()
  expect(remotePlay).toHaveBeenLastCalledWith({ url: 'http://127.0.0.1:9999' })
  expect(switchServer).not.toHaveBeenCalled()
  expect(page.get('[role="alert"]').text()).toBe('无法连接服务器')
  await page.get('[data-testid="connect-server-button"]').trigger('click')
  await flushPromises()
  expect(remotePlay).toHaveBeenCalledTimes(2)
  expect(page.find('[role="alert"]').exists()).toBe(false)
})

it('keeps an existing manager room when opening an independent remote window', async () => {
  deployment.desktop = true
  vi.stubGlobal('arcadiaDesktop', { openRemotePlay: remotePlay })
  privateRoom.currentRoom = { status: 'started', config: { roomCode: 'ABC123' } }
  const page = mount(LobbyPage, { global: { stubs } })
  await page.get('[data-testid="connect-server-button"]').trigger('click')
  await flushPromises()
  expect(remotePlay).toHaveBeenCalledOnce()
  expect(confirmSwitch).not.toHaveBeenCalled()
  expect(switchServer).not.toHaveBeenCalled()
})

it('authorizes only a main-process local host before switching the manager connection', async () => {
  deployment.desktop = true
  const start = vi.fn().mockResolvedValue({ status: 'running', url: 'http://127.0.0.1:9999' })
  vi.stubGlobal('arcadiaDesktop', { selectAndStartLocalBattle: start })
  const page = mount(LobbyPage, { global: { stubs } })
  await page.get('[data-testid="start-local-server-button"]').trigger('click')
  await flushPromises()
  expect(deployment.authorize).toHaveBeenCalledOnce()
  expect(switchServer).toHaveBeenCalledWith('http://127.0.0.1:9999')
})

it('requires confirmation before abandoning a current room for local hosting', async () => {
  deployment.desktop = true
  privateRoom.currentRoom = { status: 'started', config: { roomCode: 'ABC123' } }
  confirmSwitch.mockRejectedValueOnce('cancel')
  const start = vi.fn().mockResolvedValue({ status: 'idle' })
  vi.stubGlobal('arcadiaDesktop', { selectAndStartLocalBattle: start })
  const page = mount(LobbyPage, { global: { stubs } })
  await page.get('[data-testid="start-local-server-button"]').trigger('click')
  await flushPromises()
  expect(start).not.toHaveBeenCalled()
  expect(switchServer).not.toHaveBeenCalled()
})
