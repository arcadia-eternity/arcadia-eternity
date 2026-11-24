import { BattleMessageType, DamageType, EffectTrigger, individualValueSpread } from '@arcadia-eternity/const'
import {
  dealDamage,
  SwitchPetPhase,
  DamageContext,
  SwitchPetContext,
  TurnContext,
  UseSkillContext,
} from '@arcadia-eternity/battle/engine'
import { describe, expect, it, vi } from 'vitest'
import { petBattle } from './original-pet-battle'

it('蹦蹦鼠使用以守转攻时结算自身的印记', () => {
  const { owner, use } = petBattle('pet_bengbengshu', ['skill_yishouzhuangong'], 'mark_emblem_tiaotiaoshu')
  use('skill_yishouzhuangong')
  expect(owner.activePet.marks.map(entry => entry.baseId)).toEqual(expect.arrayContaining(['mark_yishouzhuangong']))
})

it('胖胖沱使用饮酒时结算自身的印记', () => {
  const { owner, use } = petBattle('pet_pangpangtuo', ['skill_yinjiu'], 'mark_emblem_pangpang')
  use('skill_yinjiu')
  expect(owner.activePet.marks.map(entry => entry.baseId)).toEqual(expect.arrayContaining(['mark_weizui']))
  use('skill_yinjiu')
  expect(owner.activePet.marks.some(entry => entry.baseId === 'mark_weizui')).toBe(false)
  expect(owner.activePet.marks.some(entry => entry.baseId === 'mark_lanzui')).toBe(true)
})

it('阿布布使用坚韧绷带时结算自身的印记', () => {
  const { owner, use } = petBattle('pet_abubu', ['skill_jianrenbengdai'], 'mark_emblem_abu')
  use('skill_jianrenbengdai')
  expect(owner.activePet.marks.map(entry => entry.baseId)).toEqual(
    expect.arrayContaining(['stat_stage_def_up', 'stat_stage_spd_up']),
  )
})

it.each([
  ['skill_zuzhouzhichu', 'spd'],
  ['skill_tongkuzhichu', 'spd'],
  ['skill_juewangzhichu', 'spd'],
  ['skill_bengdaisuojin', 'def'],
  ['skill_juewangbengdai', 'def'],
])('阿布布的 %s 确认命中后按 10%% 概率先降防再计算本击伤害', (skill, stat) => {
  const damage: number[] = []
  for (const [roll, expected] of [
    [0.099, true],
    [0.1, false],
  ] as const) {
    const { battle, opponent, use } = petBattle('pet_abubu', [skill])
    vi.spyOn(battle, 'random').mockReturnValue(roll)
    const markId = `stat_stage_${stat}_down`
    const weakened = () => opponent.activePet.marks.some(mark => mark.baseId === markId)
    let markedDuringDamage: boolean | undefined
    battle.registerListener(message => {
      if (message.type === BattleMessageType.Damage && message.data.target === opponent.activePet.id) {
        markedDuringDamage = weakened()
        damage.push(message.data.damage)
      }
    })
    use(skill, undefined, false)
    expect(weakened()).toBe(false)
    expect(markedDuringDamage).toBeUndefined()
    use(skill)
    expect(markedDuringDamage).toBe(expected)
    expect(weakened()).toBe(expected)
  }
  expect(damage).toHaveLength(2)
  expect(damage[0]).toBeGreaterThan(damage[1])
})

it.each([
  ['skill_zuzhoubengdai', 'stat_stage_def_down'],
  ['skill_bengdaichanrao', 'stat_stage_spe_down'],
])('%s 连续命中时在本击伤害前弱化，落空会中断连续命中', (skill, markId) => {
  const { battle, opponent, use } = petBattle('pet_abubu', [skill])
  const startingHp = opponent.activePet.currentHp
  const duringDamage: boolean[] = []
  battle.registerListener(message => {
    if (message.type === BattleMessageType.Damage && message.data.target === opponent.activePet.id) {
      duringDamage.push(opponent.activePet.marks.some(mark => mark.baseId === markId))
    }
  })
  for (const hit of [true, false, true, true]) {
    opponent.activePet.currentHp = startingHp
    use(skill, undefined, hit)
  }
  expect(duringDamage).toEqual([false, false, true])
})

it('毒粉冲击命中时按 10% 概率先提升物攻，再计算本击伤害', () => {
  const skill = 'skill_dufenchongji'
  const damage: number[] = []
  for (const [roll, expected] of [
    [0.099, true],
    [0.1, false],
  ] as const) {
    const { battle, owner, opponent, use } = petBattle('pet_yingguangdie', [skill])
    vi.spyOn(battle, 'random').mockReturnValue(roll)
    const boosted = () => owner.activePet.marks.some(mark => mark.baseId === 'stat_stage_atk_up')
    const boostsDuringDamage: boolean[] = []
    battle.registerListener(message => {
      if (message.type === BattleMessageType.Damage && message.data.target === opponent.activePet.id) {
        boostsDuringDamage.push(boosted())
        damage.push(message.data.damage)
      }
    })
    use(skill, owner, false)
    expect(boosted()).toBe(false)
    expect(boostsDuringDamage).toEqual([])
    use(skill)
    expect(boostsDuringDamage).toEqual([expected])
    expect(boosted()).toBe(expected)
  }
  expect(damage).toHaveLength(2)
  expect(damage[0]).toBeGreaterThan(damage[1])
})

it('衰弱只在确认命中后降低对手物攻和特防，即使技能没有伤害', () => {
  const skill = 'skill_shuairuo'
  const { battle, owner, opponent, use } = petBattle('pet_xiaoshugen', [skill])
  const stages = () =>
    opponent.activePet.marks
      .filter(mark => mark.baseId.startsWith('stat_stage_'))
      .map(mark => mark.baseId)
      .sort()
  const afterBeforeHit: string[][] = []
  const applyEffects = battle.applyEffects.bind(battle)
  const spy = vi.spyOn(battle, 'applyEffects').mockImplementation((context, trigger, ...sources) => {
    const result = applyEffects(context, trigger, ...sources)
    if (trigger === EffectTrigger.BeforeHit) afterBeforeHit.push(stages())
    return result
  })
  const hp = opponent.activePet.currentHp
  try {
    use(skill, owner, false)
    expect(stages()).toEqual([])
    expect(afterBeforeHit).toEqual([])
    use(skill)
    expect(afterBeforeHit).toEqual([['stat_stage_atk_down', 'stat_stage_spd_down']])
    expect(opponent.activePet.currentHp).toBe(hp)
  } finally {
    spy.mockRestore()
  }
})

it('卡尼娅使用冰封记忆时结算自身的印记', () => {
  const { owner, use } = petBattle('pet_kaniya', ['skill_bingfengjiyi'], 'mark_emblem_niya')
  use('skill_bingfengjiyi')
  expect(owner.activePet.marks.map(entry => entry.baseId)).toEqual(
    expect.arrayContaining(['stat_stage_spe_up', 'mark_bingfengjiyi']),
  )
})

it('怪笑波利使用怪笑时结算对手的印记', () => {
  const { opponent, use } = petBattle('pet_guaixiaoboli', ['skill_guaixiao'], 'mark_emblem_boli')
  use('skill_guaixiao')
  expect(opponent.activePet.marks.map(entry => entry.baseId)).toEqual(expect.arrayContaining(['stat_stage_def_down']))
})

it('火花兽使用火花印记时结算对手的印记', () => {
  const { opponent, use } = petBattle('pet_huohuashou', ['skill_huohuayinji'], 'mark_emblem_huohuali')
  use('skill_huohuayinji')
  expect(opponent.activePet.marks.map(entry => entry.baseId)).toEqual(expect.arrayContaining(['mark_huohuayinji']))
})

it('大关使用仕切势时结算自身的印记', () => {
  const { owner, use } = petBattle('pet_daguan', ['skill_shiqieshi'], 'mark_emblem_xiaojie')
  use('skill_shiqieshi')
  expect(owner.activePet.marks.map(entry => entry.baseId)).toEqual(expect.arrayContaining(['mark_shiqieshi']))
})

it('鲁卜哈利使用砂分身时结算自身的印记', () => {
  const { owner, use } = petBattle('pet_lubohali', ['skill_shafenshen'], 'mark_emblem_lulu')
  use('skill_shafenshen')
  expect(owner.activePet.marks.map(entry => entry.baseId)).toEqual(expect.arrayContaining(['mark_shafenshen_lulu']))
})

it('托尼乔巴使用红波时结算自身的印记', () => {
  const { owner, use } = petBattle('pet_tuoniqiaoba', ['skill_hongbo'], 'mark_emblem_qiaoba')
  use('skill_hongbo')
  expect(owner.activePet.marks.map(entry => entry.baseId)).toEqual(expect.arrayContaining(['mark_lanbo']))
})

it('重甲独角使用虫群潜伏时结算自身的印记', () => {
  const { owner, use } = petBattle('pet_zhongjiadujiao', ['skill_chongqunqianfu'], 'mark_emblem_dayandujiao')
  use('skill_chongqunqianfu')
  expect(owner.activePet.marks.map(entry => entry.baseId)).toEqual(expect.arrayContaining(['stat_stage_def_up']))
})

it('青蜂使用蜂纹之刻时结算对手的印记', () => {
  const { opponent, use } = petBattle('pet_qingfeng', ['skill_fengwenzhike'], 'mark_emblem_fengyong')
  use('skill_fengwenzhike')
  expect(opponent.activePet.marks.map(entry => entry.baseId)).toEqual(expect.arrayContaining(['mark_fengwen']))
})

it('紫电使用紫电通体时结算自身的印记', () => {
  const { owner, opponent, use } = petBattle('pet_zidian', ['skill_zidiantongti'], 'mark_emblem_azi')
  opponent.currentRage = 49
  use('skill_zidiantongti')
  expect(owner.activePet.marks.map(entry => entry.baseId)).toEqual(
    expect.arrayContaining(['stat_stage_atk_up', 'stat_stage_spd_up']),
  )
})

it('因卡斯特使用戾气时结算自身的印记', () => {
  const { owner, use } = petBattle('pet_yinkasite', ['skill_liqi'], 'mark_emblem_jisha')
  use('skill_liqi')
  expect(owner.activePet.marks.map(entry => entry.baseId)).toEqual(
    expect.arrayContaining(['stat_stage_atk_up', 'stat_stage_spe_up']),
  )
})

it('米奇林使用弹簧爆炸时结算自身的印记', () => {
  const { owner, use } = petBattle('pet_miqilin', ['skill_tanhuangbaozha'], 'mark_emblem_mimi')
  use('skill_tanhuangbaozha')
  expect(owner.activePet.marks.map(entry => entry.baseId)).toEqual(expect.arrayContaining(['mark_tanhuangbaozha']))
})

it('小恶魔使用恶魔之吻时结算对手的印记', () => {
  const { opponent, use } = petBattle('pet_xiaoemo', ['skill_emozhiwen'], 'mark_emblem_xiaoxiaoemo')
  use('skill_emozhiwen')
  expect(opponent.activePet.marks.map(entry => entry.baseId)).toEqual(expect.arrayContaining(['stat_stage_atk_down']))
})

it.each([
  [undefined, false],
  ['mark_emblem_huizhi', true],
] as const)('暗夜索魂曲装备 %s 时按纹章修正后的概率施加恐惧', (emblem, expected) => {
  const { battle, opponent, use } = petBattle('pet_xiaoemo', ['skill_anyesuohunqu'], emblem)
  vi.spyOn(battle, 'random').mockReturnValue(0.22)
  use('skill_anyesuohunqu')
  expect(opponent.activePet.marks.some(mark => mark.baseId === 'mark_kongju')).toBe(expected)
})

it('卡顿啾啾使用轻盈身姿时结算自身的印记', () => {
  const { owner, use } = petBattle('pet_kadunjiujiu_171', ['skill_qingyingshenzi'], 'mark_emblem_kadunjiujiu_171')
  use('skill_qingyingshenzi')
  expect(owner.activePet.marks.map(entry => entry.baseId)).toEqual(expect.arrayContaining(['stat_stage_spe_up']))
})

it('阿童钢使用战斗程序时结算自身的印记', () => {
  const { owner, use } = petBattle('pet_atonggang', ['skill_zhandouchengxu'], 'mark_emblem_atongtie')
  use('skill_zhandouchengxu')
  expect(owner.activePet.marks.map(entry => entry.baseId)).toEqual(
    expect.arrayContaining(['stat_stage_atk_up', 'stat_stage_spa_up']),
  )
})

it('米咔使用保护姿态时结算自身的印记', () => {
  const { owner, use } = petBattle('pet_mika', ['skill_baohuzitai'], 'mark_emblem_mika')
  use('skill_baohuzitai')
  expect(owner.activePet.marks.map(entry => entry.baseId)).toEqual(
    expect.arrayContaining(['stat_stage_def_up', 'stat_stage_spd_up']),
  )
})

it.each([
  { max: 31, ivs: individualValueSpread(31), expected: 31 },
  { max: 120, ivs: individualValueSpread(120), expected: 36 },
  { max: 31, ivs: individualValueSpread(20), expected: 20 },
  { max: 120, ivs: individualValueSpread(20), expected: 6 },
  { max: 31, ivs: { hp: 10, atk: 9, def: 8, spa: 7, spd: 6, spe: 5 }, expected: 7 },
  { max: 120, ivs: { hp: 10, atk: 9, def: 8, spa: 7, spd: 6, spe: 5 }, expected: 2 },
  { max: 120, ivs: individualValueSpread(31), ivMax: individualValueSpread(31), expected: 36 },
])('米咔在 $max 资质环境攻击命中时附加 $expected 点潜能固伤', ({ max, ivs, ivMax, expected }) => {
  const attack = 'skill_guangxiangongji'
  const { battle, opponent, use } = petBattle('pet_mika', [attack, 'skill_baohuzitai'], undefined, {
    individualValueMax: max,
    ivs,
    ivMax,
  })
  const hits: number[] = []
  battle.registerListener(message => {
    if (
      message.type === BattleMessageType.Damage &&
      message.data.damageType === DamageType.Effect &&
      message.data.target === opponent.activePet.id
    )
      hits.push(message.data.damage)
  })
  use('skill_baohuzitai')
  use(attack, undefined, false)
  expect(hits).toEqual([])
  use(attack)
  expect(hits).toEqual([expected])
})

it('丘吉使用尖刺甲壳时结算自身的印记', () => {
  const { owner, use } = petBattle('pet_qiuji', ['skill_jiancijiaqiao'], 'mark_emblem_qiuding')
  use('skill_jiancijiaqiao')
  expect(owner.activePet.marks.map(entry => entry.baseId)).toEqual(expect.arrayContaining(['mark_jiancijiaqiao']))
})

it('巴多使用噬魂灵柜时结算自身的印记', () => {
  const { owner, use } = petBattle('pet_baduo', ['skill_shihunlinggui'], 'mark_emblem_badu')
  use('skill_shihunlinggui')
  expect(owner.activePet.marks.map(entry => entry.baseId)).toEqual(expect.arrayContaining(['mark_badu_shihunlinggui']))
})

it('费德提克使用恐惧声波时结算对手的印记', () => {
  const { opponent, use } = petBattle('pet_feidetike', ['skill_kongjushengbo'], 'mark_emblem_feide')
  use('skill_kongjushengbo')
  expect(opponent.activePet.marks.map(entry => entry.baseId)).toEqual(expect.arrayContaining(['mark_kongju']))
})

it('诺基博使用东风时结算自身的印记', () => {
  const { owner, use } = petBattle('pet_nuojibo', ['skill_dongfeng'], 'mark_emblem_nuoji')
  use('skill_dongfeng')
  expect(owner.activePet.marks.map(entry => entry.baseId)).toEqual(expect.arrayContaining(['mark_nuoji_dongfeng']))
})

it.each([1, 80])('万事俱备消耗东风后仅为下一只己方诺基博回复半血，初始体力为 %i%%', percent => {
  const skills = ['skill_dongfeng', 'skill_wanshijubei']
  const { battle, owner, use } = petBattle('pet_nuojibo', skills, undefined, undefined, [
    { species: 'pet_nuoji', skills: ['skill_baiwei'] },
    { species: 'pet_nuojibo', skills },
  ])
  const [donor, other, recipient] = owner.team
  const switchTo = (pet: typeof donor) =>
    battle.phaseManager.run(new SwitchPetPhase(new SwitchPetContext(new TurnContext(battle), owner, pet)))
  const endTurn = () => battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnEnd)
  recipient.currentHp = Math.floor((recipient.stat.maxHp * percent) / 100)
  const before = recipient.currentHp
  use('skill_wanshijubei')
  endTurn()
  switchTo(recipient)
  expect(recipient.currentHp).toBe(before)
  switchTo(donor)
  use('skill_dongfeng')
  endTurn()
  expect(donor.marks.some(mark => mark.baseId === 'mark_nuoji_dongfeng')).toBe(false)
  other.currentHp = 1
  switchTo(other)
  expect(other.currentHp).toBe(1)
  donor.currentHp = 1
  switchTo(donor)
  expect(donor.currentHp).toBe(1)
  switchTo(recipient)
  expect(recipient.currentHp).toBe(Math.min(recipient.stat.maxHp, before + Math.floor(recipient.stat.maxHp / 2)))
  switchTo(other)
  recipient.currentHp = 1
  switchTo(recipient)
  expect(recipient.currentHp).toBe(1)
})

it('凯瑟琳使用阳炎时结算场地效果', () => {
  const { battle, use } = petBattle('pet_kaiselin', ['skill_yangyan'], 'mark_emblem_kaise')
  use('skill_yangyan')
  expect(battle.marks.map(entry => entry.baseId)).toEqual(expect.arrayContaining(['mark_global_yanre']))
})

it('克里普特使用分析报告时结算对手的印记', () => {
  const { opponent, use } = petBattle('pet_kelipute', ['skill_fenxibaogao'], 'mark_emblem_kelipu')
  use('skill_fenxibaogao')
  expect(opponent.activePet.marks.map(entry => entry.baseId)).toEqual(
    expect.arrayContaining(['stat_stage_def_down', 'stat_stage_spd_down']),
  )
})

it.each([
  [undefined, 15],
  ['mark_emblem_yingguang', 20],
] as const)('星光反攻弹装备 %s 时施加 %i 层命中下降', (emblem, stacks) => {
  const { opponent, use } = petBattle('pet_kelipute', ['skill_xingguangfangongdan'], emblem)
  use('skill_xingguangfangongdan')
  expect(opponent.activePet.marks.find(mark => mark.baseId === 'mark_mingzhongxiajiang')?.stack).toBe(stacks)
})

it('艾萨卡使用祥云之术时结算自身的印记', () => {
  const { owner, use } = petBattle('pet_aisaka', ['skill_xiangyunzhishu'], 'mark_emblem_aisa')
  use('skill_xiangyunzhishu')
  expect(owner.activePet.marks.map(entry => entry.baseId)).toEqual(
    expect.arrayContaining(['stat_stage_atk_up', 'stat_stage_spa_up']),
  )
})

it('哞哞王使用哞哞哞哞时结算自身的印记', () => {
  const { owner, use } = petBattle('pet_moumouwang', ['skill_moumoumoumou'], 'mark_emblem_moumou')
  use('skill_moumoumoumou')
  expect(owner.activePet.marks.map(entry => entry.baseId)).toEqual(expect.arrayContaining(['stat_stage_atk_up']))
})

it('威朗普使用血之沸腾时结算自身的印记', () => {
  const { owner, use } = petBattle('pet_weilangpu', ['skill_xuezhifeiteng'], 'mark_emblem_langpu')
  use('skill_xuezhifeiteng')
  expect(owner.activePet.marks.map(entry => entry.baseId)).toEqual(
    expect.arrayContaining(['stat_stage_def_up', 'stat_stage_spd_up']),
  )
})

it('因卡斯特命中破地和苍月技能时依次替换目标的状态', () => {
  const { opponent, use } = petBattle('pet_yinkasite', ['skill_podijiaoren', 'skill_cangyuekongzhan'])
  const target = opponent.activePet
  const hp = target.currentHp
  const has = (id: string) => target.marks.some(mark => mark.baseId === id && mark.isActive)
  use('skill_podijiaoren')
  expect(has('mark_zhikong')).toBe(true)
  target.currentHp = hp
  use('skill_cangyuekongzhan')
  expect(has('mark_zhuiluo')).toBe(true)
  expect(has('mark_zhikong')).toBe(false)
})

it('威朗普受到暴击后为自身获得会心', () => {
  const { battle, opponent, owner } = petBattle('pet_weilangpu', ['skill_bingbao_huinu'])
  const attacker = opponent.activePet
  const skill = attacker.skills[0]!
  const cast = new UseSkillContext(new TurnContext(battle), opponent, attacker, skill.target, skill)
  dealDamage(new DamageContext(cast, skill, owner.activePet, 20, DamageType.Physical, true))
  expect(owner.activePet.marks.some(mark => mark.baseId === 'mark_huixin')).toBe(true)
  expect(attacker.marks.some(mark => mark.baseId === 'mark_haipa')).toBe(false)
})

it('大关的力士纹章让架势后的下个攻击技能威力提高10%', () => {
  const { owner, use } = petBattle('pet_daguan', ['skill_shiqieshi', 'skill_bailietui'], 'mark_emblem_xiaojie')
  use('skill_shiqieshi')
  const strike = owner.activePet.skills.find(skill => skill.baseId === 'skill_bailietui')!
  const power = strike.power
  expect(use('skill_bailietui').power).toBeCloseTo(power * 1.1)
  expect(use('skill_bailietui').power).toBe(power)
})

it('米奇林在累计损失第 200 点体力时崩坏，并停止积累弹力', () => {
  const { owner, opponent, battle } = petBattle('pet_miqilin', ['skill_tanshe'])
  const attacker = opponent.activePet
  const target = owner.activePet
  const skill = attacker.skills[0]!
  const cast = new UseSkillContext(new TurnContext(battle), opponent, attacker, skill.target, skill)
  const strike = (damage: number) => dealDamage(new DamageContext(cast, skill, target, damage, DamageType.Physical))
  const mark = (id: string) => target.marks.find(entry => entry.baseId === id && entry.isActive)
  strike(199)
  expect(mark('mark_tanli')?.stack).toBe(199)
  expect(mark('mark_benghuai')).toBeUndefined()
  strike(1)
  expect(mark('mark_benghuai')).toBeDefined()
  strike(1)
  expect(mark('mark_tanli')?.stack).toBe(200)
})

it.each([
  [49, 0, 1],
  [50, 0, 0],
  [51, 1, 0],
])('对手有 %i 点怒气时紫电光与紫电破各自判定先制', (rage, above, below) => {
  const { owner, opponent, battle } = petBattle('pet_zidian', ['skill_zidianguang', 'skill_zidianpo'])
  opponent.currentRage = rage
  const priorities = owner.activePet.skills.map(skill => {
    const cast = new UseSkillContext(new TurnContext(battle), owner, owner.activePet, skill.target, skill)
    battle.applyEffects(cast, EffectTrigger.BeforeSort)
    return cast.priority
  })
  expect(priorities).toEqual([above, below])
})

it('青蜂每消耗一层蜂纹增加一次实际连击', () => {
  const { opponent, use } = petBattle('pet_qingfeng', ['skill_fengwenzhike', 'skill_fengwenxuanwu'])
  use('skill_fengwenzhike')
  expect(opponent.activePet.marks.find(mark => mark.baseId === 'mark_fengwen')?.stack).toBe(1)
  expect(use('skill_fengwenxuanwu').multihitResult).toBe(4)
  expect(opponent.activePet.marks.some(mark => mark.baseId === 'mark_fengwen')).toBe(false)
})

it('哞王之怒仅在上一招落空时恢复怒气', () => {
  const { owner, use } = petBattle('pet_moumouwang', ['skill_jilang', 'skill_mouwangzhinu'])
  use('skill_jilang', owner, false)
  expect(owner.activePet.lastMissedSkillId).toBe('skill_jilang')
  use('skill_mouwangzhinu')
  const afterMiss = owner.currentRage
  expect(owner.activePet.lastMissedSkillId).toBeUndefined()
  use('skill_mouwangzhinu')
  expect(owner.currentRage).toBeLessThan(afterMiss)
})

it('两个储备箱使储备弹实际少支付 10 点怒气', () => {
  const { owner, use } = petBattle('pet_kelipute', ['skill_daijizhuangtai', 'skill_chubeidan'])
  use('skill_daijizhuangtai')
  const cast = use('skill_chubeidan', owner, false)
  expect(cast.rage).toBe(5)
  expect(owner.currentRage).toBe(owner.maxRage - 5)
})

it('弹簧体质持续五回合，受到物攻时反弹固定 30 点', () => {
  const { opponent, owner, use } = petBattle('pet_miqilin', ['skill_tanhuangtizhi'])
  use('skill_tanhuangtizhi')
  expect(owner.activePet.marks.find(mark => mark.baseId === 'mark_tanhuangtizhi')?.duration).toBe(5)
  const before = opponent.activePet.currentHp
  use('skill_paida', opponent)
  expect(before - opponent.activePet.currentHp).toBe(30)
})

it('穿透电球自带必中和穿盾，起跳仍能回避这次特攻', () => {
  const { owner, opponent, use } = petBattle(
    'pet_zidian',
    ['skill_chuantoudianqiu'],
    undefined,
    undefined,
    [],
    [{ species: 'pet_bengbengshu', skills: ['skill_qitiao'] }],
  )
  const attack = use('skill_chuantoudianqiu', owner, null)
  expect(attack.hitResult).toBe(true)
  expect(attack.ignoreShield).toBe(true)
  use('skill_qitiao', opponent)
  const hp = opponent.activePet.currentHp
  expect(use('skill_chuantoudianqiu', owner, null).hitResult).toBe(false)
  expect(opponent.activePet.currentHp).toBe(hp)
})

it.each([
  [49, 3],
  [50, 2],
])('紫电连斩在对手怒气 %i 时打 %i 击', (rage, hits) => {
  const { battle, opponent, use } = petBattle('pet_zidian', ['skill_zidianlianzhan'])
  vi.spyOn(battle, 'randomInt').mockImplementation((_, high) => high)
  opponent.currentRage = rage
  expect(use('skill_zidianlianzhan').multihitResult).toBe(hits)
})

it.each(['min', 'max'] as const)('手舞足蹈按清醒、微醉、烂醉分别结算连击（%s）', endpoint => {
  const { battle, opponent, use } = petBattle('pet_pangpangtuo', ['skill_shouwuzudao', 'skill_yinjiu'])
  vi.spyOn(battle, 'randomInt').mockImplementation((low, high) => (endpoint === 'min' ? low : high))
  const hp = opponent.activePet.currentHp
  for (const [index, hits] of (endpoint === 'min' ? [1, 2, 3] : [1, 3, 5]).entries()) {
    if (index > 0) use('skill_yinjiu')
    opponent.activePet.currentHp = hp
    expect(use('skill_shouwuzudao').multihitResult).toBe(hits)
  }
})

it.each([
  [0.099, 2],
  [0.1, 1],
])('苍月极刃斩在随机值 %f 时打 %i 击', (roll, hits) => {
  const { battle, owner, use } = petBattle('pet_yinkasite', ['skill_cangyuejirenzhan'])
  vi.spyOn(battle, 'random').mockReturnValue(roll)
  expect(use('skill_cangyuejirenzhan').multihitResult).toBe(hits)
  expect(owner.activePet.marks.some(mark => mark.baseId === 'mark_lianji')).toBe(false)
})

it.each([
  ['pet_abubu', 'skill_beishangfanji', -1],
  ['pet_moumouwang', 'skill_chaojihailiu', 1],
] as const)('%s 的 %s 在出手排序时只计算一次固有先后制', (species, skillId, priority) => {
  const { battle, owner } = petBattle(species, [skillId])
  const skill = owner.activePet.skills[0]!
  const cast = new UseSkillContext(new TurnContext(battle), owner, owner.activePet, skill.target, skill)
  battle.applyEffects(cast, EffectTrigger.BeforeSort)
  expect(cast.priority).toBe(priority)
})

it('逆水行舟仅在持有逆流时跳过命中检定', () => {
  const { battle, owner, use } = petBattle('pet_naiputulong', ['skill_nishuixingzhou', 'skill_shuiqiang'])
  vi.spyOn(battle, 'random').mockReturnValue(0.999)
  expect(use('skill_nishuixingzhou', owner, null).hitResult).toBe(false)
  use('skill_shuiqiang')
  expect(owner.activePet.marks.some(mark => mark.baseId === 'mark_niliu')).toBe(true)
  expect(use('skill_nishuixingzhou', owner, null).hitResult).toBe(true)
})

it.each([
  ['pet_kadunqiujiu', 'skill_xinzhiyinji', 'skill_hongxinyu', 1, 8],
  ['pet_yiluxin', 'skill_huanxiangshijie', 'skill_huawu', 1, 5],
  ['pet_xiaoemo', 'skill_emoqiyue', 'skill_diyuzhiyu', 2, 4],
] as const)('%s 使用 %s 后，%s 能打出条件连击上限', (species, setup, move, baseHits, hits) => {
  const { battle, opponent, use } = petBattle(species, [setup, move])
  vi.spyOn(battle, 'randomInt').mockImplementation((_, high) => high)
  const hp = opponent.activePet.currentHp
  expect(use(move).multihitResult).toBe(baseHits)
  opponent.activePet.currentHp = hp
  use(setup)
  expect(use(move).multihitResult).toBe(hits)
})

it('砂瀑送葬在命中判定前消耗两个砂分身，一层时照常判定', () => {
  const { battle, owner, use } = petBattle('pet_lubohali', ['skill_shafenshen', 'skill_shapusongzang'])
  vi.spyOn(battle, 'random').mockReturnValue(0.99)
  const stacks = () => owner.activePet.marks.find(mark => mark.baseId === 'mark_shafenshen_lulu')?.stack ?? 0
  use('skill_shafenshen')
  expect(use('skill_shapusongzang', owner, null).hitResult).toBe(false)
  expect(stacks()).toBe(1)
  use('skill_shafenshen')
  expect(use('skill_shapusongzang', owner, null).hitResult).toBe(true)
  expect(stacks()).toBe(0)
})

describe.each([
  {
    species: 'pet_baduo',
    stat: 'spd',
    power5: 'skill_linghunzhifa',
    power10: 'skill_lihunsuiji',
    multi: 'skill_linghunlianda',
  },
  {
    species: 'pet_qiuji',
    stat: 'def',
    power5: 'skill_jiancichongzhuang',
    power10: 'skill_licitujin',
    multi: 'skill_jiancifangun',
  },
] as const)('$species 防御属性换算', ({ species, stat, power5, power10, multi }) => {
  it.each([
    ['power5', 4, 75, 123, 131],
    ['power5', 499, 174, 280, 131],
    ['power5', 500, 175, 280, 131],
    ['power5', 505, 175, 280, 131],
    ['power10', 999, 169, 277, 123],
    ['power10', 1000, 170, 278, 123],
    ['power10', 1010, 170, 278, 123],
  ] as const)('%s 属性 %i 时威力为 %i', (formula, value, expectedPower, baduDamage, qiudingDamage) => {
    const move = formula === 'power5' ? power5 : power10
    const { owner, opponent, battle, use } = petBattle(species, [move])
    owner.activePet.attributeSystem.updateBaseValue(stat, value)
    vi.spyOn(battle, 'random').mockReturnValue(0.5)
    const hp = opponent.activePet.currentHp
    expect(use(move).power).toBe(expectedPower)
    expect(hp - opponent.activePet.currentHp).toBe(stat === 'spd' ? baduDamage : qiudingDamage)
  })

  it.each([
    [99, 1],
    [199, 1],
    [200, 2],
    [599, 5],
    [600, 6],
    [700, 6],
  ])('属性 %i 时实际造成 %i 次伤害', (value, hits) => {
    const { owner, opponent, battle, use } = petBattle(species, [multi])
    owner.activePet.attributeSystem.updateBaseValue(stat, value)
    opponent.activePet.attributeSystem.updateBaseValue('maxHp', 5000)
    opponent.activePet.currentHp = 5000
    let landed = 0
    battle.registerListener(message => {
      if (message.type === BattleMessageType.Damage && message.data.target === opponent.activePet.id) landed++
    })
    expect(use(multi).multihitResult).toBe(hits)
    expect(landed).toBe(hits)
  })
})

it.each([
  ['skill_yingjiazhongji', 'skill_bujiuzhongji', 'skill_lingduzhongji', 80],
  ['skill_zhongjiachuanci', 'skill_bujiuchuanci', 'skill_lingduchuanci', 90],
] as const)('只有上次落空的是 %s 才加倍威力或获得焦点腐蚀', (miss, power, focus, base) => {
  const { owner, opponent, use } = petBattle('pet_zhongjiadujiao', [miss, power, focus])
  opponent.activePet.attributeSystem.updateBaseValue('maxHp', 5000)
  opponent.activePet.currentHp = 5000
  const focused = () => owner.activePet.marks.some(mark => mark.baseId === 'mark_jiaodianfushi')
  use(focus, owner, false)
  expect(use(power).power).toBe(base)
  expect(focused()).toBe(false)
  use(miss, owner, false)
  expect(use(power).power).toBe(base * 2)
  expect(focused()).toBe(false)
  use(miss, owner, false)
  use(focus)
  expect(focused()).toBe(true)
})
