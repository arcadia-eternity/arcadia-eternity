import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { registerMediaEnvironment } from '@/services/mediaLoader'
import { useMusic } from '../music'
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
vi.mock('@/services/resourceTransport', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/resourceTransport')>()),
  readResourceBytes: mocks.bytes,
}))
vi.mock('howler', () => ({
  Howl: class {
    constructor(options: unknown) {
      mocks.howler(options)
    }
    playing = vi.fn(() => false)
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
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function consumer() {
  let sound!: ReturnType<typeof useSound>
  const wrapper = mount(
    defineComponent({
      setup() {
        sound = useSound()
        return () => h('div')
      },
    }),
  )
  return { wrapper, sound }
}

it.each([
  ['1', 'https://seer2-resource.yuuinih.com/sound/pet/6.mp3', 'official-assets/resource/sound/pet/6.mp3'],
  ['', 'https://seer2-resource.yuuinih.com/sound/pet/6.mp3', 'https://seer2-resource.yuuinih.com/sound/pet/6.mp3'],
  ['1', 'https://creator.test/cry.mp3', 'https://creator.test/cry.mp3'],
])('resolves declared cries in static mode %s: %s', async (mode, source, expected) => {
  vi.stubEnv('VITE_STATIC_MODE', mode)
  vi.stubEnv('BASE_URL', './')
  mocks.getSpecies.mockReturnValue({ id: 'pet_xiuluosi', presentation: { cry: source } })
  mocks.bytes.mockRejectedValue(new Error('Stop after recording the requested URL'))
  const { wrapper, sound } = consumer()
  sound.playPetSound('pet_xiuluosi')
  await flushPromises()
  wrapper.unmount()
  expect(mocks.bytes).toHaveBeenCalledWith(new URL(expected, document.baseURI).href, expect.any(Object))
})

it('keeps missing remote skill/cry/victory media silent without consulting same-ID or numeric local media', async () => {
  setServerContentText({ species: [], skills: [], marks: [] })
  const { wrapper, sound } = consumer()
  sound.playSkillSound('skill_qili' as baseSkillId)
  sound.playPetSound('pet_dilan')
  await sound.prepareVictorySound()
  sound.playVictorySound()
  await flushPromises()
  expect(mocks.bytes).not.toHaveBeenCalled()
  expect(mocks.howler).not.toHaveBeenCalled()
  expect(mocks.lookupSkill).not.toHaveBeenCalled()
  expect(mocks.lookupPet).not.toHaveBeenCalled()
  wrapper.unmount()
})

it('uses declared local skill audio, ignores missing cry declarations and consumes remote audio references', async () => {
  setServerContentText({ species: [], skills: [], marks: [] }, false)
  mocks.serverFallback = false
  mocks.getSkill.mockReturnValue({ id: 'skill_qili', presentation: { sfx: 'https://local.test/declared.mp3' } })
  const local = consumer()
  local.sound.playSkillSound('skill_qili' as baseSkillId)
  local.sound.playPetSound('pet_dilan')
  expect(mocks.lookupSkill).not.toHaveBeenCalled()
  await flushPromises()
  expect(mocks.bytes).toHaveBeenCalledWith('https://local.test/declared.mp3', expect.any(Object))
  expect(mocks.lookupPet).not.toHaveBeenCalled()
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

it('waits for the selected BGM to finish loading in Howler', async () => {
  const catalog = { species: [], skills: [], marks: [] }
  registerMediaEnvironment(catalog, 'music-test', [
    { id: 'track', source: 'https://audio.test/track.ogg', tags: ['music'] },
  ])
  setServerContentText(catalog)
  mocks.bytes.mockResolvedValue(new Uint8Array([79, 103, 103, 83]))
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:music-test')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  let music!: ReturnType<typeof useMusic>
  const wrapper = mount(
    defineComponent({
      setup() {
        music = useMusic(false)
        return () => h('div')
      },
    }),
  )
  try {
    const ready = vi.fn()
    const pending = music.whenMusicReady().then(ready)
    await flushPromises()
    expect(mocks.howler).toHaveBeenCalledOnce()
    expect(ready).not.toHaveBeenCalled()
    mocks.howler.mock.calls[0]![0].onload()
    await pending
    expect(ready).toHaveBeenCalledOnce()
  } finally {
    wrapper.unmount()
  }
})

it('prepares the declared KO sound before the first playback and reuses its blob', async () => {
  const catalog = { species: [], skills: [], marks: [] }
  const source = 'https://audio.test/ko.ogg'
  registerMediaEnvironment(catalog, 'ko-test', [{ id: 'finish', source, tags: ['battle-ui:ko'] }])
  setServerContentText(catalog)
  const bytes = Promise.withResolvers<Uint8Array>()
  mocks.bytes.mockReturnValue(bytes.promise)
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:ko')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const play = vi.fn(async () => {})
  vi.stubGlobal(
    'Audio',
    class {
      play = play
      pause = vi.fn()
      addEventListener = vi.fn()
    },
  )
  const { sound, wrapper } = consumer()
  try {
    const ready = vi.fn()
    const preparing = sound.prepareVictorySound().then(ready)
    await flushPromises()
    expect(mocks.bytes).toHaveBeenCalledWith(source, expect.any(Object))
    expect(ready).not.toHaveBeenCalled()
    bytes.resolve(new Uint8Array([79, 103, 103, 83]))
    await preparing
    expect(play).not.toHaveBeenCalled()
    sound.playVictorySound()
    expect(play).toHaveBeenCalledOnce()
    expect(create).toHaveBeenCalledOnce()
    expect(mocks.bytes).toHaveBeenCalledTimes(1)
  } finally {
    wrapper.unmount()
  }
})
