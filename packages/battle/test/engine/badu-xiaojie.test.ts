import type { Pet } from '@arcadia-eternity/battle/engine'
import { DamageType, individualValueSpread } from '@arcadia-eternity/const'
import { expect, it } from 'vitest'
import { petBattle, strike, waitTurn } from './original-pet-battle'

function activeMark(pet: Pet, baseId: string) {
  return pet.marks.find(mark => mark.baseId === baseId && mark.isActive)
}

it('噬魂灵柜反弹本次伤害的一半（上限284）并在结算后消耗，同时扣除对手10怒气', () => {
  const { battle, owner, opponent, use } = petBattle(
    'pet_baduo',
    ['skill_shihunlinggui'],
    undefined,
    {
      individualValueMax: 120,
      ivs: individualValueSpread(120),
    },
    [],
    [{ species: 'pet_dilante', skills: ['skill_paida'] }],
  )
  use('skill_shihunlinggui')
  expect(activeMark(owner.activePet, 'mark_badu_shihunlinggui')).toBeDefined()

  opponent.currentRage = 50
  const opponentBefore = opponent.activePet.currentHp

  const result = strike(battle, opponent.activePet, owner.activePet, 570, DamageType.Physical)

  expect(result.hpLoss).toBe(570)
  expect(opponent.activePet.currentHp).toBe(opponentBefore - 284)
  expect(opponent.currentRage).toBe(40)
  expect(activeMark(owner.activePet, 'mark_badu_shihunlinggui')).toBeUndefined()

  const opponentAfter = opponent.activePet.currentHp
  strike(battle, opponent.activePet, owner.activePet, 100, DamageType.Physical)
  expect(opponent.activePet.currentHp).toBe(opponentAfter)
})

it('幽魂灵柜先恢复13%最大体力，再抵挡下一次攻击的50%伤害并消耗', () => {
  const { battle, owner, opponent, use } = petBattle('pet_baduo', ['skill_youhunlinggui'])
  const maxHp = owner.activePet.stat.maxHp
  owner.activePet.currentHp = Math.floor(maxHp / 2)
  const before = owner.activePet.currentHp

  use('skill_youhunlinggui')

  expect(owner.activePet.currentHp - before).toBe(Math.floor(maxHp * 0.13))
  expect(activeMark(owner.activePet, 'mark_badu_youhunlinggui')).toBeDefined()

  const result = strike(battle, opponent.activePet, owner.activePet, 200, DamageType.Special)

  expect(result.hpLoss).toBe(100)
  expect(activeMark(owner.activePet, 'mark_badu_youhunlinggui')).toBeUndefined()
})

it('对手使用属性技能不会消耗幽魂灵柜或触发害怕', () => {
  const { owner, opponent, use } = petBattle(
    'pet_baduo',
    ['skill_youhunlinggui'],
    undefined,
    undefined,
    [],
    [{ species: 'pet_daguan', skills: ['skill_shiqieshi'] }],
  )
  use('skill_youhunlinggui')

  use('skill_shiqieshi', opponent)

  expect(activeMark(opponent.activePet, 'mark_haipa')).toBeUndefined()
  expect(activeMark(owner.activePet, 'mark_badu_youhunlinggui')).toBeDefined()
  expect(activeMark(owner.activePet, 'mark_haipa')).toBeUndefined()
})

it.each([
  [80, 0],
  [200, 100],
])('历魂灵柜按2倍怒气抵挡伤害并在成功时消耗一半怒气（%i点伤害）', (incoming, expectedLoss) => {
  const { battle, owner, opponent, use } = petBattle('pet_baduo', ['skill_lihunlinggui'])
  use('skill_lihunlinggui')
  owner.currentRage = 50

  const result = strike(battle, opponent.activePet, owner.activePet, incoming, DamageType.Physical)

  expect(result.hpLoss).toBe(expectedLoss)
  const damageRage = expectedLoss === 0 ? 0 : Math.floor((expectedLoss * 49) / owner.activePet.stat.maxHp)
  expect(owner.currentRage).toBe(25 + damageRage)
  expect(activeMark(owner.activePet, 'mark_badu_lihunlinggui')).toBeUndefined()
})

it('尘手势只抵挡并反弹本次物攻伤害的一半，然后消耗', () => {
  const { battle, owner, opponent, use } = petBattle('pet_daguan', ['skill_chenshoushi'])
  use('skill_chenshoushi')
  expect(activeMark(owner.activePet, 'mark_chenshoushi')).toBeDefined()

  const opponentBefore = opponent.activePet.currentHp
  const result = strike(battle, opponent.activePet, owner.activePet, 200, DamageType.Physical)

  expect(result.hpLoss).toBe(100)
  expect(opponent.activePet.currentHp).toBe(opponentBefore - 100)
  expect(activeMark(owner.activePet, 'mark_chenshoushi')).toBeUndefined()
})

it('蹲踞势只抵挡并反弹本次特攻伤害的一半，然后消耗', () => {
  const { battle, owner, opponent, use } = petBattle('pet_daguan', ['skill_dunjushi'])
  use('skill_dunjushi')
  expect(activeMark(owner.activePet, 'mark_dunjushi')).toBeDefined()

  const opponentBefore = opponent.activePet.currentHp
  const result = strike(battle, opponent.activePet, owner.activePet, 200, DamageType.Special)

  expect(result.hpLoss).toBe(100)
  expect(opponent.activePet.currentHp).toBe(opponentBefore - 100)
  expect(activeMark(owner.activePet, 'mark_dunjushi')).toBeUndefined()
})

it('无双势按受到伤害的一半积累无双力，无双力只在下一次攻击技能结算威力后消耗', () => {
  const { battle, owner, opponent, use } = petBattle('pet_daguan', [
    'skill_wushuangshi',
    'skill_lanzu',
    'skill_bailietui',
  ])
  use('skill_wushuangshi')
  expect(activeMark(owner.activePet, 'mark_wushuangshi')).toBeDefined()

  strike(battle, opponent.activePet, owner.activePet, 200, DamageType.Physical)

  expect(activeMark(owner.activePet, 'mark_wushuangshi')).toBeUndefined()
  expect(activeMark(owner.activePet, 'mark_wushuangli')?.stack).toBe(100)

  use('skill_lanzu')
  expect(activeMark(owner.activePet, 'mark_wushuangli')?.stack).toBe(100)

  const attack = use('skill_bailietui')
  expect(attack.power).toBe(125)
  expect(activeMark(owner.activePet, 'mark_wushuangli')).toBeUndefined()
})

it('鬼无双把下一次攻击技能的伤害加成设为40%而不是1%', () => {
  const { owner, use } = petBattle('pet_daguan', ['skill_guiwushuang', 'skill_bailietui'])

  use('skill_guiwushuang')
  expect(activeMark(owner.activePet, 'mark_shanghaizengjia')?.stack).toBe(40)

  const attack = use('skill_bailietui')
  expect(attack.power).toBeCloseTo(25 * 1.4)
  expect(activeMark(owner.activePet, 'mark_shanghaizengjia')).toBeUndefined()
})

it('仕切势在下一回合增伤40%，随后到期', () => {
  const { battle, owner, opponent, use } = petBattle('pet_daguan', ['skill_shiqieshi'])
  use('skill_shiqieshi')
  for (const expected of [20, 28, 20]) {
    expect(strike(battle, owner.activePet, opponent.activePet, 20, DamageType.Physical).modifiedDamage).toBe(expected)
    waitTurn(battle)
  }
})

it('巴度纹章减免崩坏重拳的自身效果伤害，噬魂灵柜保留到受到攻击', () => {
  const { owner, opponent, use } = petBattle(
    'pet_baduo',
    ['skill_shihunlinggui', 'skill_benghuaizhongquan'],
    'mark_emblem_badu',
  )
  const caster = owner.activePet
  const fullHp = caster.currentHp
  use('skill_benghuaizhongquan', owner, false)
  expect(fullHp - caster.currentHp).toBe(50)

  use('skill_shihunlinggui')
  const before = caster.currentHp
  use('skill_benghuaizhongquan', owner, false)
  expect(before - caster.currentHp).toBe(47)
  expect(activeMark(caster, 'mark_badu_shihunlinggui')).toBeDefined()
  use('skill_paida', opponent)
  expect(activeMark(caster, 'mark_badu_shihunlinggui')).toBeUndefined()
})
