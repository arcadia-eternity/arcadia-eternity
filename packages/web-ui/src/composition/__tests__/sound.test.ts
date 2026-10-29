import { mount, flushPromises } from '@vue/test-utils'
import { computed, defineComponent, h } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setServerContentText } from '@/i18n/serverContent'
import { useSound } from '../sound'
import type { baseSkillId } from '@arcadia-eternity/const'

const mocks = vi.hoisted(() => ({
  getSkill: vi.fn(),
  getSpecies: vi.fn(),
  lookupSkill: vi.fn(),
  lookupPet: vi.fn(),
  howler: vi.fn(),
  bytes: vi.fn(),
  serverFallback: true,
}))
vi.mock('@/stores/gameData', () => ({
  useGameDataStore: () => ({
    getSkill: mocks.getSkill,
    getSpecies: mocks.getSpecies,
    get serverFallback() {
      return mocks.serverFallback
    },
  }),
}))
vi.mock('@/stores/resource', () => ({
  useResourceStore: () => ({ getSkillSound: mocks.lookupSkill, getPetSoundByNum: mocks.lookupPet }),
}))
vi.mock('@/services/resourceTransport', () => ({ readResourceBytes: mocks.bytes }))
vi.mock('howler', () => ({
  Howl: class {
    constructor(options: unknown) {
      mocks.howler(options)
    }
    play = vi.fn()
    stop = vi.fn()
    unload = vi.fn()
    mute = vi.fn()
    volume = vi.fn()
  },
}))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  mocks.serverFallback = true
  mocks.getSkill.mockReturnValue({ id: 'skill_qili' })
  mocks.getSpecies.mockReturnValue({ id: 'pet_dilan', num: 1 })
  mocks.lookupSkill.mockReturnValue('https://local.test/same-id.mp3')
  mocks.lookupPet.mockReturnValue('https://local.test/same-number.mp3')
})
afterEach(() => {
  setServerContentText(null)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function consumer() {
  let sound!: ReturnType<typeof useSound>
  const wrapper = mount(
    defineComponent({
      setup() {
        sound = useSound(
          computed(() => ['skill_qili' as baseSkillId]),
          computed(() => [1]),
        )
        return () => h('div')
      },
    }),
  )
  return { wrapper, sound }
}

it('keeps missing remote skill/cry/victory media silent without consulting same-ID or numeric local media', async () => {
  setServerContentText({ species: [], skills: [], marks: [] })
  const { wrapper, sound } = consumer()
  sound.playSkillSound('skill_qili' as baseSkillId)
  sound.playPetSound(1, 'pet_dilan')
  sound.playVictorySound()
  await flushPromises()
  expect(mocks.bytes).not.toHaveBeenCalled()
  expect(mocks.howler).not.toHaveBeenCalled()
  expect(mocks.lookupSkill).not.toHaveBeenCalled()
  expect(mocks.lookupPet).not.toHaveBeenCalled()
  wrapper.unmount()
})

it('retains trusted local numeric/skill fallback and consumes explicit remote audio references', async () => {
  setServerContentText({ species: [], skills: [], marks: [] }, false)
  mocks.serverFallback = false
  const local = consumer()
  local.sound.playSkillSound('skill_qili' as baseSkillId)
  local.sound.playPetSound(1, 'pet_dilan')
  expect(mocks.lookupSkill).toHaveBeenCalledWith('skill_qili')
  expect(mocks.lookupPet).toHaveBeenCalledWith(1)
  expect(mocks.howler).toHaveBeenCalled()
  local.wrapper.unmount()
  vi.clearAllMocks()
  mocks.serverFallback = true
  setServerContentText({ species: [], skills: [], marks: [] })
  mocks.getSkill.mockReturnValue({ id: 'skill_qili', presentation: { sfx: 'https://server.test/declared.ogg' } })
  mocks.bytes.mockResolvedValue(new Uint8Array([79, 103, 103, 83]))
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:owned-audio')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.stubGlobal(
    'Audio',
    class {
      volume = 1
      play = vi.fn(async () => {})
      pause = vi.fn()
      addEventListener = vi.fn()
    },
  )
  const remote = consumer()
  remote.sound.playSkillSound('skill_qili' as baseSkillId)
  await flushPromises()
  expect(mocks.bytes).toHaveBeenCalledWith('https://server.test/declared.ogg', expect.any(Object))
  expect(mocks.howler).not.toHaveBeenCalled()
  remote.wrapper.unmount()
})
