import {
  SwitchPetPhase,
  executeTurnOperation,
  UseSkillContext,
  SwitchPetContext,
  TurnContext,
  type Player,
} from '@arcadia-eternity/battle/engine'
import { DamageType } from '@arcadia-eternity/const'
import { expect, it, vi } from 'vitest'
import { petBattle, strike, waitTurn } from './original-pet-battle'

const hasMark = (player: Player, id: string) => player.activePet.marks.some(mark => mark.baseId === id && mark.isActive)
const findMark = (player: Player, id: string) =>
  player.activePet.marks.find(mark => mark.baseId === id && mark.isActive)

it('劝酒把美酒诱惑施加给自己，并在下一次受到物攻后使攻击者烂醉', () => {
  const { battle, owner, opponent, use } = petBattle('pet_pangpangtuo', ['skill_quanjiu'])
  use('skill_quanjiu')
  expect(findMark(owner, 'mark_meijiuyouhuo')?.duration).toBe(2)
  expect(hasMark(opponent, 'mark_meijiuyouhuo')).toBe(false)
  use('skill_paida', opponent)
  expect(hasMark(opponent, 'mark_lanzui')).toBe(false)
  waitTurn(battle)

  use('skill_paida', opponent)
  expect(findMark(opponent, 'mark_lanzui')).toBeDefined()
  expect(findMark(owner, 'mark_meijiuyouhuo')).toBeUndefined()
})

it('绷带替身只把下一次受击怒气翻倍并在触发后消耗', () => {
  const control = petBattle('pet_abubu', ['skill_paida'])
  control.owner.currentRage = 0
  control.use('skill_paida', control.opponent)
  const normalRage = control.owner.currentRage

  const { owner, opponent, use } = petBattle('pet_abubu', ['skill_bengdaitishen'])
  use('skill_bengdaitishen')
  expect(findMark(owner, 'mark_bengdaitishen')?.duration).toBe(-1)
  owner.currentRage = 0
  use('skill_paida', opponent)
  expect(owner.currentRage).toBe(normalRage * 2)
  expect(findMark(owner, 'mark_bengdaitishen')).toBeUndefined()
})

it('火花印记让下一次攻击必定暴击并消耗印记', () => {
  const { opponent, use } = petBattle('pet_huohuashou', ['skill_huohuayinji', 'skill_huohuakeyin'])
  use('skill_huohuayinji')
  expect(findMark(opponent, 'mark_huohuayinji')?.duration).toBe(-1)

  use('skill_huohuakeyin', undefined, false)
  expect(findMark(opponent, 'mark_huohuayinji')).toBeDefined()
  const cast = use('skill_huohuakeyin')
  expect(cast.crit).toBe(true)
  expect(hasMark(opponent, 'mark_shaoshang')).toBe(true)
  expect(findMark(opponent, 'mark_huohuayinji')).toBeUndefined()
})

it('蓄电持续两回合，不再按技能次数消耗层数', () => {
  const { battle, owner, use } = petBattle('pet_zidian', ['skill_xudian', 'skill_leidian'])
  use('skill_xudian')
  const mark = findMark(owner, 'mark_xudian')
  expect(mark?.duration).toBe(2)
  expect(mark?.stack).toBe(1)
  expect(mark?.config.maxStacks).toBe(1)

  const first = use('skill_leidian')
  expect(findMark(owner, 'mark_xudian')).toBeDefined()
  expect(first.power).toBeCloseTo(102)
  const second = use('skill_leidian')
  expect(findMark(owner, 'mark_xudian')).toBeDefined()
  expect(second.power).toBeCloseTo(102)

  waitTurn(battle)
  expect(findMark(owner, 'mark_xudian')?.duration).toBe(1)
  waitTurn(battle)
  expect(findMark(owner, 'mark_xudian')).toBeUndefined()
})

it('弹簧爆炸保持到下一次被攻击，触发后消耗', () => {
  const { owner, opponent, use } = petBattle('pet_miqilin', ['skill_tanhuangbaozha'])
  use('skill_tanhuangbaozha')
  expect(findMark(owner, 'mark_tanhuangbaozha')?.duration).toBe(-1)
  use('skill_paida', opponent)
  expect(findMark(owner, 'mark_tanhuangbaozha')).toBeUndefined()
})

it('彩霞之心最多三层，每层提供 15% 暴击率，暴击后消耗', () => {
  const { battle, owner, use } = petBattle('pet_aisaka', ['skill_caixiazhixin', 'skill_xuancaiguangshu'])
  use('skill_caixiazhixin')
  const mark = findMark(owner, 'mark_caixiazhixin')
  expect(mark?.stack).toBe(3)
  expect(mark?.duration).toBe(-1)
  expect(mark?.config.maxStacks).toBe(3)

  const baseCrit = owner.activePet.stat.critRate
  vi.spyOn(battle, 'random').mockReturnValue(0)
  const cast = use('skill_xuancaiguangshu')
  expect(cast.critRate).toBe(baseCrit + 50) // 彩霞之心 45% + 艾萨特性 5%
  expect(cast.crit).toBe(true)
  expect(findMark(owner, 'mark_caixiazhixin')).toBeUndefined()
})

it('炫光奇点只保留一层并提供固定的 50% 暴击伤害', () => {
  const { owner, use } = petBattle('pet_aisaka', ['skill_xuanguangqidian'])
  use('skill_xuanguangqidian')
  const mark = findMark(owner, 'mark_xuanguangqidian')
  expect(mark?.stack).toBe(1)
  expect(mark?.duration).toBe(-1)
  expect(mark?.config.maxStacks).toBe(1)
})

it('血红印记等同三回合心之印记', () => {
  const { opponent, use } = petBattle('pet_kadunjiujiu_171', ['skill_xuehongyinji'])
  use('skill_xuehongyinji')
  expect(findMark(opponent, 'mark_xuehongyinji')?.duration).toBe(3)
})

it('回旋光刃的再次使用加成只生效一次', () => {
  const { owner, use } = petBattle('pet_mika', ['skill_huixuanguangren'])
  use('skill_huixuanguangren', owner, false)
  expect(findMark(owner, 'mark_huixuanguangren')).toBeDefined()
  const boosted = use('skill_huixuanguangren')
  expect(boosted.power).toBeCloseTo(100)
  expect(findMark(owner, 'mark_huixuanguangren')).toBeUndefined()
})

it('潜地弹随换场转移给上场精灵并造成 150 点固定伤害', () => {
  const target = { species: 'pet_dilan', skills: ['skill_paida'] }
  const { battle, opponent, use } = petBattle(
    'pet_kelipute',
    ['skill_qiandidan'],
    undefined,
    undefined,
    [],
    [target, target],
  )
  use('skill_qiandidan')
  expect(hasMark(opponent, 'mark_qiandidan')).toBe(true)
  const incoming = opponent.team[1]!
  const before = incoming.currentHp
  battle.phaseManager.run(new SwitchPetPhase(new SwitchPetContext(new TurnContext(battle), opponent, incoming)))
  expect(opponent.activePet).toBe(incoming)
  expect(hasMark(opponent, 'mark_qiandidan')).toBe(true)
  expect(incoming.currentHp).toBe(before - 150)
})

it('阿布之怨按实际抵挡量扣怒，可以连续抵挡，到第三回合结束时失效', () => {
  const { battle, owner, opponent, use } = petBattle('pet_abubu', ['skill_abuzhiyuan'])
  use('skill_abuzhiyuan')
  owner.currentRage = 20
  const defend = (amount: number) => strike(battle, opponent.activePet, owner.activePet, amount)
  expect(defend(11).hpLoss).toBe(0)
  expect(owner.currentRage).toBe(14)
  expect(defend(40).hpLoss).toBe(12)
  expect(findMark(owner, 'mark_abuzhiyuan')?.stack).toBe(1)
  owner.currentRage = 0
  expect(defend(20).hpLoss).toBe(20)
  for (let i = 0; i < 3; i++) waitTurn(battle)
  expect(hasMark(owner, 'mark_abuzhiyuan')).toBe(false)
})

it('雪之外衣保留剩余护盾，跨过三回合后仍吸收剩余伤害并按实际吸收量回血', () => {
  const { battle, owner, opponent, use } = petBattle('pet_kaniya', ['skill_xuezhiwaiyi'])
  owner.activePet.currentHp -= 100
  use('skill_xuezhiwaiyi')
  const hp = owner.activePet.currentHp
  expect(strike(battle, opponent.activePet, owner.activePet, 20).hpLoss).toBe(0)
  expect(owner.activePet.currentHp).toBe(hp + 10)
  for (let i = 0; i < 4; i++) waitTurn(battle)
  expect(findMark(owner, 'mark_xuezhiwaiyi')?.stack).toBe(80)
  expect(strike(battle, opponent.activePet, owner.activePet, 90).hpLoss).toBe(10)
  expect(owner.activePet.currentHp).toBe(hp + 40)
  expect(hasMark(owner, 'mark_xuezhiwaiyi')).toBe(false)
})

it('冰封记忆跨六回合记录强化，再次使用时恢复记录并解除印记', () => {
  const { battle, owner, use } = petBattle('pet_kaniya', ['skill_bingfengjiyi', 'skill_hushen'])
  use('skill_hushen')
  use('skill_bingfengjiyi')
  const stages = () =>
    owner.activePet.marks.filter(mark => mark.baseId.startsWith('stat_stage_')).map(mark => [mark.baseId, mark.stack])
  const saved = stages()
  use('skill_hushen')
  expect(stages()).not.toEqual(saved)
  for (let i = 0; i < 6; i++) waitTurn(battle)
  expect(hasMark(owner, 'mark_bingfengjiyi')).toBe(true)
  use('skill_bingfengjiyi')
  expect(stages()).toEqual(saved)
  expect(hasMark(owner, 'mark_bingfengjiyi')).toBe(false)
})

it('以守转攻只在当回合减伤，在下一回合增伤，然后到期', () => {
  const { battle, owner, opponent, use } = petBattle('pet_bengbengshu', ['skill_yishouzhuangong'])
  use('skill_yishouzhuangong')
  for (const [received, dealt] of [
    [10, 20],
    [20, 30],
    [20, 20],
  ]) {
    expect(strike(battle, opponent.activePet, owner.activePet, 20).hpLoss).toBe(received)
    expect(strike(battle, owner.activePet, opponent.activePet, 20).hpLoss).toBe(dealt)
    waitTurn(battle)
  }
})

it('狂欢曲仅在下一回合结束时结算，施放者换场会取消', () => {
  for (const switchCaster of [false, true]) {
    const { battle, owner, opponent, use } = petBattle(
      'pet_feidetike',
      ['skill_tianyuankuanghuanqu'],
      undefined,
      undefined,
      [{ species: 'pet_dilan', skills: ['skill_paida'] }],
    )
    vi.spyOn(battle, 'random').mockReturnValue(0.7)
    use('skill_tianyuankuanghuanqu')
    const damage = Math.floor(owner.activePet.stat.maxHp / 2)
    const hp = opponent.activePet.currentHp
    waitTurn(battle)
    expect(opponent.activePet.currentHp).toBe(hp)
    expect(hasMark(opponent, 'mark_kuanghuanqu')).toBe(true)
    if (switchCaster)
      battle.phaseManager.run(new SwitchPetPhase(new SwitchPetContext(new TurnContext(battle), owner, owner.team[1]!)))
    waitTurn(battle)
    expect(opponent.activePet.currentHp).toBe(Math.max(0, hp - (switchCaster ? 0 : damage)))
    expect(hasMark(opponent, 'mark_kuanghuanqu')).toBe(false)
  }
})

it('阿童钢的物理吸收与特殊反射仅由符合类别和阈值的攻击触发', () => {
  const { battle, owner, opponent, use } = petBattle('pet_atonggang', ['skill_wulixishou', 'skill_teshufanshe'])
  const pet = owner.activePet
  pet.currentHp -= 40
  use('skill_wulixishou')
  const hp = pet.currentHp
  expect(strike(battle, opponent.activePet, pet, 10, DamageType.Special).hpLoss).toBe(10)
  expect(strike(battle, opponent.activePet, pet, 15).status).toBe('replaced')
  expect(pet.currentHp).toBe(hp + 5)
  expect(hasMark(owner, 'mark_wulixishou_atongtie')).toBe(false)
  use('skill_teshufanshe')
  const half = Math.floor(pet.stat.maxHp / 2)
  expect(strike(battle, opponent.activePet, pet, half, DamageType.Special).hpLoss).toBe(half)
  const attackerHp = opponent.activePet.currentHp
  expect(strike(battle, opponent.activePet, pet, half + 1, DamageType.Special).hpLoss).toBe(0)
  expect(opponent.activePet.currentHp).toBe(Math.max(0, attackerHp - half - 1))
  expect(hasMark(owner, 'mark_teshufanshe_atongtie')).toBe(false)
})

it('等着瞧吧在闪避攻击时回满怒气', () => {
  const { owner, opponent, use } = petBattle('pet_feidetike', ['skill_dengzheqiaoba'])
  const evasion = owner.activePet.stat.evasion
  use('skill_dengzheqiaoba')
  expect(owner.currentRage).toBeLessThan(100)
  expect(owner.activePet.stat.evasion).toBe(evasion + 35)
  use('skill_paida', opponent, false)
  expect(owner.currentRage).toBe(100)
})

it('变速在重复变速突击和等待时保留，下一个不同技能实际排序时先制加一', () => {
  const { battle, owner, opponent, use } = petBattle('pet_bengbengshu', ['skill_biansutuji', 'skill_yishouzhuangong'])
  use('skill_biansutuji')
  use('skill_biansutuji', owner, false)
  for (let i = 0; i < 3; i++) waitTurn(battle)
  expect(hasMark(owner, 'mark_biansu')).toBe(true)
  const skill = owner.activePet.skills[1]!
  owner.currentRage = 100
  owner.selection = battle
    .getAvailableSelection(owner.id)
    .find(choice => choice.type === 'use-skill' && choice.skill === skill.id)!
  opponent.selection = { player: opponent.id, type: 'do-nothing' }
  const turn = new TurnContext(battle)
  executeTurnOperation(turn, battle)
  const cast = turn.appledContexts.find(entry => entry instanceof UseSkillContext)
  expect(cast?.priority).toBe(skill.priority + 1)
  expect(hasMark(owner, 'mark_biansu')).toBe(false)
})

it('光之盾在先出手的当回合抵挡并反弹一半攻击伤害', () => {
  const { battle, owner, opponent, use } = petBattle('pet_mika', ['skill_guangzhidun'])
  use('skill_guangzhidun')
  const hp = opponent.activePet.currentHp
  expect(strike(battle, opponent.activePet, owner.activePet, 100).hpLoss).toBe(50)
  expect(opponent.activePet.currentHp).toBe(hp - 50)
  use('skill_guangzhidun')
  waitTurn(battle)
  expect(hasMark(owner, 'mark_guangzhidun')).toBe(false)
})

it('过载只锁持有方怒气，使用必杀时正常付费并解除过载', () => {
  const { battle, owner, opponent, use } = petBattle('pet_atonggang', ['skill_zhandouchengxu', 'skill_atonggangtiepao'])
  owner.currentRage = 100
  waitTurn(battle)
  expect(hasMark(owner, 'mark_guozai_atongtie')).toBe(true)
  use('skill_zhandouchengxu')
  expect(owner.currentRage).toBe(100)
  opponent.currentRage = 0
  waitTurn(battle)
  expect(opponent.currentRage).toBeGreaterThan(0)
  use('skill_atonggangtiepao')
  expect(hasMark(owner, 'mark_guozai_atongtie')).toBe(false)
  expect(owner.currentRage).toBeLessThan(100)
})
