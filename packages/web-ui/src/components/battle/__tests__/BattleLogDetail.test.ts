import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import { BattleMessageType } from '@arcadia-eternity/const'
import { useBattleStore } from '@/stores/battle'
import type { TimestampedBattleMessage } from '@/symbol/battlelog'
import BattleLogDetail from '../BattleLogDetail.vue'

vi.mock('i18next', () => ({ default: { on: vi.fn(), t: (key: string) => key } }))

function message(type: BattleMessageType, data: unknown, receivedAt: number) {
  return { type, data, receivedAt, stateDelta: {} } as unknown as TimestampedBattleMessage
}

beforeEach(() => {
  setActivePinia(createPinia())
  const store = useBattleStore()
  store.log = [
    message(BattleMessageType.BattleStart, {}, 1),
    message(BattleMessageType.TurnStart, { turn: 1 }, 2),
    message(
      BattleMessageType.Damage,
      { target: 'pet_a', damage: 40, damageType: 'Physical', currentHp: 60, maxHp: 100, effectiveness: 1 },
      3,
    ),
    message(BattleMessageType.TurnStart, { turn: 2 }, 4),
    message(BattleMessageType.RageChange, { pet: 'pet_a', before: 10, after: 25, reason: 'round-recover' }, 5),
  ]
})

it('groups every battle message by turn and closes on escape', async () => {
  const wrapper = mount(BattleLogDetail, { attachTo: document.body })
  const headings = wrapper.findAll('.battle-log-detail__turn h3').map(node => node.text())
  expect(headings).toEqual(['第 1 回合', '第 2 回合'])
  expect(wrapper.text()).toContain('pet_a 受到 40 点 物理伤害')
  expect(wrapper.text()).toContain('pet_a 怒气 10 → 25 (回合恢复)')
  expect(wrapper.text()).not.toContain('对战开始')

  await wrapper.get('[aria-pressed="false"]').trigger('click')
  expect(wrapper.findAll('.battle-log-detail__turn h3').map(node => node.text())[0]).toBe('开场')

  await wrapper.get('input[type="search"]').setValue('怒气')
  expect(wrapper.findAll('.battle-log-detail__entry')).toHaveLength(1)

  await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Escape' })
  expect(wrapper.emitted('close')).toHaveLength(1)
  wrapper.unmount()
})
