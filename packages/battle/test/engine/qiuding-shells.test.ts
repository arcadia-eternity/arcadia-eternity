import { BattleMessageType, DamageType, individualValueSpread, type DamageResult } from '@arcadia-eternity/const'
import { executeTurnOperation, TurnContext } from '@arcadia-eternity/battle/engine'
import { expect, it } from 'vitest'
import { petBattle, strike, waitTurn } from './original-pet-battle'

function shellBattle(id: string, individualValueMax?: number) {
  const training = individualValueMax
    ? { individualValueMax, ivs: individualValueSpread(individualValueMax) }
    : undefined
  const fixture = petBattle('pet_qiuji', [id], undefined, training)
  const { owner, opponent, battle, use } = fixture
  use(id)
  function attack(amount: number, type = DamageType.Physical) {
    return strike(battle, opponent.activePet, owner.activePet, amount, type)
  }
  const hasShell = () => owner.activePet.marks.some(mark => mark.baseId === id.replace('skill_', 'mark_'))
  return { ...fixture, attack, hasShell }
}

it('倒刺甲壳保留到下一次攻击，抵挡一半并给攻击者三回合的30点流血', () => {
  const { battle, opponent, use, attack, hasShell } = shellBattle('skill_daocijiaqiao')
  waitTurn(battle)
  use('skill_paida', opponent, false)
  expect(hasShell()).toBe(true)
  expect(attack(100).hpLoss).toBe(50)
  expect(hasShell()).toBe(false)
  expect(attack(100).hpLoss).toBe(100)
  const hp = opponent.activePet.currentHp
  for (let i = 1; i <= 4; i++) {
    waitTurn(battle)
    expect(opponent.activePet.currentHp).toBe(hp - Math.min(i, 3) * 30)
  }
})

it('尖刺甲壳不被效果伤害消耗，受到下一次攻击才反弹并额外回15怒', () => {
  const { opponent, owner, battle, attack, hasShell } = shellBattle('skill_jiancijiaqiao')
  const hp = opponent.activePet.currentHp
  attack(16, DamageType.Effect)
  expect(opponent.activePet.currentHp).toBe(hp)
  expect(hasShell()).toBe(true)
  waitTurn(battle)
  owner.currentRage = 0
  const hit = attack(100, DamageType.Special)
  expect(opponent.activePet.currentHp).toBe(hp - 50)
  expect(owner.currentRage).toBe(15 + Math.floor((hit.hpLoss * 49) / owner.activePet.stat.maxHp))
  expect(hasShell()).toBe(false)
  attack(50)
  expect(opponent.activePet.currentHp).toBe(hp - 50)
})

it('尖刺甲壳受重击时反弹伤害封顶284点', () => {
  const { opponent, battle, attack } = shellBattle('skill_jiancijiaqiao', 120)
  const reflected: number[] = []
  battle.registerListener(message => {
    if (message.type === BattleMessageType.Damage && message.data.target === opponent.activePet.id)
      reflected.push(message.data.damage)
  })
  expect(attack(580).hpLoss).toBe(580)
  expect(reflected).toEqual([284])
})

it.each([0, 50, 100])('暴怒甲壳按 %i 点怒气抵挡伤害，成功时才消耗印记和一半怒气', rage => {
  const { owner, attack, hasShell, battle } = shellBattle('skill_baonujiaqiao')
  waitTurn(battle)
  owner.currentRage = rage
  const hit = attack(100)
  expect(hit.hpLoss).toBe(100 - rage)
  expect(hasShell()).toBe(rage === 0)
  expect(owner.currentRage).toBe(
    rage - Math.floor(rage / 2) + Math.floor((hit.hpLoss * 49) / owner.activePet.stat.maxHp),
  )
})

it('尖刺爆发在下一次攻击命中时才消耗，跨回合和落空保留', () => {
  const { battle, owner, opponent, use } = petBattle('pet_qiuji', ['skill_jiancibaofa', 'skill_jianci'])
  use('skill_jiancibaofa')
  const marked = () => opponent.activePet.marks.some(mark => mark.baseId === 'mark_jiancibaofa')
  waitTurn(battle)
  waitTurn(battle)
  use('skill_jianci', owner, false)
  expect(marked()).toBe(true)
  expect(use('skill_jianci').critRate).toBe(owner.activePet.stat.critRate + 50)
  expect(marked()).toBe(false)
  expect(use('skill_jianci').critRate).toBe(owner.activePet.stat.critRate)
})

it('迪兰用拍打命中尖刺甲壳，当次实际伤害决定反弹的体力', () => {
  const { owner, opponent, use, hasShell } = shellBattle('skill_jiancijiaqiao')
  const before = owner.activePet.currentHp
  const attackerHp = opponent.activePet.currentHp
  use('skill_paida', opponent)
  const lost = before - owner.activePet.currentHp
  expect(lost).toBeGreaterThan(1)
  expect(opponent.activePet.currentHp).toBe(attackerHp - Math.floor(lost / 2))
  expect(hasShell()).toBe(false)
})

it('尖刺冲撞命中飞行系时仍结算附加的固定伤害', () => {
  const skill = 'skill_jiancichongzhuang'
  const { owner, opponent, use } = petBattle(
    'pet_qiuji',
    [skill],
    undefined,
    undefined,
    [],
    [{ species: 'pet_kelipute', skills: ['skill_paida'] }],
  )
  owner.activePet.attributeSystem.updateBaseValue('def', 500)
  const hp = opponent.activePet.currentHp
  expect(use(skill).typeMultiplier).toBe(0)
  expect(opponent.activePet.currentHp).toBe(hp - 100)
})

it('沙之厉在施放者换下后继续为队友的沙漠系攻击增伤', () => {
  const { owner, opponent, battle, use } = petBattle('pet_qiuji', ['skill_shazhili'], undefined, undefined, [
    { species: 'pet_baduo', skills: ['skill_lihunsuiji'] },
  ])
  use('skill_shazhili')
  owner.selection = { type: 'switch-pet', player: owner.id, pet: owner.team[1]!.id }
  opponent.selection = { type: 'do-nothing', player: opponent.id }
  executeTurnOperation(new TurnContext(battle), battle)
  for (let i = 0; i < 3; i++) waitTurn(battle)
  const hits: DamageResult[] = []
  battle.registerListener(message => {
    if (
      message.type === BattleMessageType.Damage &&
      message.data.target === opponent.activePet.id &&
      message.data.result
    )
      hits.push(message.data.result)
  })
  use('skill_lihunsuiji')
  expect(hits).toHaveLength(1)
  const { intent, modifiedDamage } = hits[0]!
  expect(modifiedDamage).toBe(Math.floor(intent.baseDamage * intent.randomFactor * 1.5))
})
