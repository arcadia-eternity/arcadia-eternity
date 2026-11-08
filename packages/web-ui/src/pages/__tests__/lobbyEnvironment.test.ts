import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { computed, defineComponent, inject, provide, reactive, type ComputedRef } from 'vue'
import type { PreparedPersonalEnvironment } from '@/services/personalEnvironment'
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
const setPersonalEnvironment = vi.fn()
const switchServer = vi.fn()
const confirmSwitch = vi.fn()
let battleClient: { currentState: { status: string }; serverUrl: string }
let privateRoom: {
  currentRoom: { status: string; config: { roomCode: string } } | null
  isSwitchingServer: boolean
  personalEnvironment: PreparedPersonalEnvironment | undefined
  setPersonalEnvironment: typeof setPersonalEnvironment
  environments: Array<{
    id: string
    packages: { name: string; version: string }[]
    executionPolicy?: 'server' | 'peer'
  }>
  refreshEnvironments: typeof refreshEnvironments
  createRoom: typeof createRoom
  switchServer: typeof switchServer
}
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/stores/privateRoom', () => ({ usePrivateRoomStore: () => privateRoom }))
vi.mock('@/stores/matchmaking', () => ({ useMatchmakingStore: () => ({ waiting: false }) }))
vi.mock('@/stores/battleClient', () => ({ useBattleClientStore: () => battleClient }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ invalidationReason: null }) }))
vi.mock('@/utils/env', () => ({ isDesktop: false }))
vi.mock('element-plus', () => ({
  ElMessage: { error: vi.fn(), success: vi.fn() },
  ElMessageBox: { confirm: (...args: unknown[]) => confirmSwitch(...args) },
}))

function preparedPersonalEnvironment(): PreparedPersonalEnvironment {
  const descriptor: PreparedPersonalEnvironment['reference']['descriptor'] = {
    id: 'a'.repeat(64),
    protocolVersion: 1,
    executionPolicy: 'peer',
    peerRevision: 'personal-revision',
    runtime: { kind: 'native-v4', contentRevision: 'personal', coreBuildId: 'core', registryBuildId: 'registry' },
    packages: [{ name: '@player/custom', version: '1.0.0', projectId: 'custom', namespace: 'custom' }],
    resourceRevision: 'personal-resources',
    resources: [],
  }
  const rules = { schemaVersion: 1 as const }
  const content = { species: [], skills: [], marks: [] }
  const environment = { revision: 'personal-revision', data: content, modules: [] }
  return {
    reference: {
      kind: 'personal',
      protocolVersion: 1,
      descriptor,
      rules,
      source: { kind: 'file', name: 'custom.json' },
    },
    environment,
    content,
    acceptance: {
      environmentId: descriptor.id,
      protocolVersion: 1,
      resourceRevision: descriptor.resourceRevision,
      resourcesReady: true,
    },
    bundle: { format: 'arcadia.personal-environment', version: 1, descriptor, rules, environment, content },
    release: vi.fn(),
  }
}
let personalEnvironment: PreparedPersonalEnvironment

const stubs = {
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
  ElRadioGroup: defineComponent({
    props: ['modelValue'],
    emits: ['update:modelValue'],
    setup(props, { emit }) {
      provide('test-radio-group', {
        selected: computed(() => props.modelValue),
        select: (value: unknown) => emit('update:modelValue', value),
      })
      return {}
    },
    template: '<div role="radiogroup"><slot /></div>',
  }),
  ElRadio: defineComponent({
    props: ['value'],
    setup() {
      return { group: inject<{ selected: ComputedRef<unknown>; select(value: unknown): void }>('test-radio-group')! }
    },
    template:
      '<label><input type="radio" :checked="group.selected.value === value" @change="group.select(value)" /><slot /></label>',
  }),
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
  PersonalEnvironmentPicker: {
    props: ['prepared', 'disabled'],
    emits: ['prepared', 'error'],
    setup: () => ({ result: personalEnvironment }),
    template:
      '<button data-testid="accept-personal-environment" :disabled="disabled" @click="$emit(\'prepared\', result)">选择并接受个人环境</button>',
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  deployment.desktop = false
  remotePlay.mockReset().mockResolvedValue(undefined)
  personalEnvironment = preparedPersonalEnvironment()
  battleClient = reactive({ currentState: { status: 'connected' }, serverUrl: 'http://localhost:8102' })
  privateRoom = reactive({
    currentRoom: null,
    isSwitchingServer: false,
    personalEnvironment: undefined,
    setPersonalEnvironment,
    environments: [],
    refreshEnvironments,
    createRoom,
    switchServer,
  })
  switchServer.mockReset().mockResolvedValue(undefined)
  confirmSwitch.mockReset().mockResolvedValue('confirm')
  setPersonalEnvironment.mockReset().mockImplementation(async (value: PreparedPersonalEnvironment) => {
    privateRoom.personalEnvironment = value
  })
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
  expect(createRoom).toHaveBeenCalledWith(expect.objectContaining({ battleMode: 'server' }), 'ugc', undefined)
  expect(push).toHaveBeenCalledWith('/room/ABC123')
})

it('keeps the server default available when the catalog is unavailable and clears incompatible selections on P2P switch', async () => {
  refreshEnvironments.mockRejectedValueOnce(new Error('offline'))
  const page = mount(LobbyPage, { global: { stubs } })
  await page.get('[data-testid="create-private-room-button"]').trigger('click')
  await flushPromises()
  expect(page.text()).toContain('内容列表暂不可用')
  await page.get('[data-testid="confirm-create-private-room-button"]').trigger('click')
  await flushPromises()
  expect(createRoom).toHaveBeenLastCalledWith(expect.objectContaining({ battleMode: 'server' }), undefined, undefined)
  await page.get('[data-testid="create-private-room-button"]').trigger('click')
  await flushPromises()
  await page.get('[data-testid="room-environment-select"]').setValue('ugc')
  await page.get('[data-testid="p2p"]').trigger('click')
  expect(page.get('[data-testid="room-environment-select"]').text()).toContain('服务器默认内容')
  await page.get('[data-testid="confirm-create-private-room-button"]').trigger('click')
  await flushPromises()
  expect(createRoom).toHaveBeenLastCalledWith(expect.objectContaining({ battleMode: 'p2p' }), undefined, undefined)
})

it('offers a published peer-only environment only for player-hosted room creation', async () => {
  refreshEnvironments.mockImplementationOnce(async () => {
    privateRoom.environments = [
      { id: 'official', packages: [] },
      { id: 'peer', packages: [{ name: '@example/peer', version: '2.0.0' }], executionPolicy: 'peer' },
    ]
  })
  const page = mount(LobbyPage, { global: { stubs } })
  await page.get('[data-testid="create-private-room-button"]').trigger('click')
  await flushPromises()
  expect(page.get('[data-testid="room-environment-select"]').text()).not.toContain('@example/peer')
  expect(page.text()).toContain('仅允许玩家主机运行')
  await page.get('[data-testid="p2p"]').trigger('click')
  expect(page.get('[data-testid="room-environment-select"]').text()).toContain('@example/peer 2.0.0')
  await page.get('[data-testid="room-environment-select"]').setValue('peer')
  await page.get('[data-testid="confirm-create-private-room-button"]').trigger('click')
  await flushPromises()
  expect(createRoom).toHaveBeenCalledWith(expect.objectContaining({ battleMode: 'p2p' }), 'peer', undefined)
  page.unmount()
})

it.each(['pending', 'selected'] as const)(
  'creates a personal room independently of a %s server catalog',
  async catalogState => {
    let finishCatalog!: () => void
    if (catalogState === 'pending') {
      refreshEnvironments.mockImplementationOnce(
        () =>
          new Promise<void>(resolve => {
            finishCatalog = resolve
          }),
      )
    } else {
      refreshEnvironments.mockImplementationOnce(async () => {
        privateRoom.environments = [
          { id: 'peer', packages: [{ name: '@server/peer', version: '2.0.0' }], executionPolicy: 'peer' },
        ]
      })
    }
    const page = mount(LobbyPage, { global: { stubs } })
    await page.get('[data-testid="create-private-room-button"]').trigger('click')
    await flushPromises()
    await page.get('[data-testid="p2p"]').trigger('click')
    if (catalogState === 'selected') await page.get('[data-testid="room-environment-select"]').setValue('peer')
    await page
      .findAll('label')
      .find(label => label.text() === '我的环境')!
      .get('input')
      .setValue(true)
    expect(page.find('[data-testid="room-environment-select"]').exists()).toBe(false)
    expect(page.get('[data-testid="confirm-create-private-room-button"]').attributes('disabled')).toBeDefined()
    expect(createRoom).not.toHaveBeenCalled()

    await page.get('[data-testid="accept-personal-environment"]').trigger('click')
    await flushPromises()
    expect(setPersonalEnvironment).toHaveBeenCalledWith(personalEnvironment)
    expect(
      privateRoom.environments.some(environment => environment.id === personalEnvironment.reference.descriptor.id),
    ).toBe(false)
    expect(page.get('[data-testid="confirm-create-private-room-button"]').attributes('disabled')).toBeUndefined()
    await page.get('[data-testid="confirm-create-private-room-button"]').trigger('click')
    await flushPromises()
    expect(createRoom).toHaveBeenCalledWith(
      expect.objectContaining({ battleMode: 'p2p' }),
      undefined,
      personalEnvironment.reference,
    )
    expect(push).toHaveBeenCalledWith('/room/ABC123')
    finishCatalog?.()
    await flushPromises()
    page.unmount()
  },
)

it('browser keeps connection identity in the top bar without a local-host entry', () => {
  const page = mount(LobbyPage, { global: { stubs } })
  expect(page.find('[data-testid="current-server-address"]').exists()).toBe(false)
  expect(page.find('[data-testid="server-address-input"]').exists()).toBe(false)
  expect(page.find('[data-testid="start-local-server-button"]').exists()).toBe(false)
})

it('desktop retains server navigation without duplicating connection identity', async () => {
  deployment.desktop = true
  vi.stubGlobal('arcadiaDesktop', { openRemotePlay: remotePlay })
  const page = mount(LobbyPage, { global: { stubs } })
  await flushPromises()
  expect(page.find('[data-testid="current-server-address"]').exists()).toBe(false)
  expect(page.find('[data-testid="server-address-input"]').exists()).toBe(false)
  expect(page.find('[data-testid="connect-server-button"]').exists()).toBe(false)
  expect(remotePlay).not.toHaveBeenCalled()
  expect(switchServer).not.toHaveBeenCalled()
})

it('keeps an existing manager room when visiting the lobby', async () => {
  deployment.desktop = true
  vi.stubGlobal('arcadiaDesktop', { openRemotePlay: remotePlay })
  privateRoom.currentRoom = { status: 'started', config: { roomCode: 'ABC123' } }
  const page = mount(LobbyPage, { global: { stubs } })
  await flushPromises()
  expect(page.text()).toContain('回到房间 (ABC123)')
  expect(privateRoom.currentRoom?.config.roomCode).toBe('ABC123')
  expect(remotePlay).not.toHaveBeenCalled()
  expect(confirmSwitch).not.toHaveBeenCalled()
  expect(switchServer).not.toHaveBeenCalled()
})

it('links to server management without starting a host or abandoning the room', async () => {
  deployment.desktop = true
  privateRoom.currentRoom = { status: 'started', config: { roomCode: 'ABC123' } }
  const page = mount(LobbyPage, { global: { stubs } })
  expect(page.text()).toContain('查看与管理服务器')
  expect(page.find('[data-testid="start-local-server-button"]').exists()).toBe(false)
  expect(switchServer).not.toHaveBeenCalled()
})
