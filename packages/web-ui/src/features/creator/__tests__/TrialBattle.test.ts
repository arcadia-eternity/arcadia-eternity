import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { NativeWorkSelection } from '@arcadia-eternity/pack-loader/native'
import TrialBattle from '../TrialBattle.vue'

const launch = vi.hoisted(() => ({ create: vi.fn(() => 'ticket'), take: vi.fn(), push: vi.fn() }))
vi.mock('@/services/localBattleSession', () => ({
  createCreatorTrialLaunch: launch.create,
  takeCreatorTrialLaunch: launch.take,
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: launch.push }), isNavigationFailure: () => false }))
const selection = { base: { marks: [], skills: [], species: [] }, selected: [], installed: [] } as NativeWorkSelection
const render = (beforeLaunch: () => Promise<void>) =>
  mount(TrialBattle, {
    props: { beforeLaunch, selection, species: [{ id: 'trial:pet', label: '试战精灵', skills: ['trial:strike'] }] },
  })
afterEach(() => vi.clearAllMocks())

it('does not leave the editor or allocate a trial when saving the draft fails', async () => {
  const view = render(async () => {
    throw new Error('草稿存在冲突')
  })
  await view.get('button').trigger('click')
  await flushPromises()
  expect(view.get('[role="alert"]').text()).toBe('草稿存在冲突')
  expect(launch.create).not.toHaveBeenCalled()
  expect(launch.push).not.toHaveBeenCalled()
  view.unmount()
})

it('does not create or navigate a trial when saving finishes after the editor was closed', async () => {
  let saved!: () => void
  const saving = new Promise<void>(resolve => {
    saved = resolve
  })
  const view = render(() => saving)
  await view.get('button').trigger('click')
  view.unmount()
  saved()
  await flushPromises()
  expect(launch.create).not.toHaveBeenCalled()
  expect(launch.push).not.toHaveBeenCalled()
})

it('releases an unclaimed snapshot if navigation fails after saving', async () => {
  const dispose = vi.fn(async () => {})
  launch.take.mockReturnValue({ dispose })
  launch.push.mockRejectedValueOnce(new Error('导航失败'))
  const save = vi.fn(async () => {})
  const view = render(save)
  await view.get('button').trigger('click')
  await flushPromises()
  expect(save).toHaveBeenCalledOnce()
  expect(launch.create).toHaveBeenCalledOnce()
  expect(launch.take).toHaveBeenCalledWith('ticket')
  expect(dispose).toHaveBeenCalledOnce()
  expect(view.get('[role="alert"]').text()).toBe('导航失败')
  view.unmount()
})
