import { BattleMessageType, DamageType, EffectTrigger, individualValueSpread } from '@arcadia-eternity/const'
import { DamageContext, SwitchPetContext, TurnContext, UseSkillContext } from '@arcadia-eternity/battle/engine'
import { expect, it, vi } from 'vitest'
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

it('诅咒绷带连续命中时在本击伤害前降物防，落空会中断连续命中', () => {
  const skill = 'skill_zuzhoubengdai'
  const { battle, opponent, use } = petBattle('pet_abubu', [skill])
  const startingHp = opponent.activePet.currentHp
  const duringDamage: boolean[] = []
  battle.registerListener(message => {
    if (message.type === BattleMessageType.Damage && message.data.target === opponent.activePet.id) {
      duringDamage.push(opponent.activePet.marks.some(mark => mark.baseId === 'stat_stage_def_down'))
    }
  })
  for (const hit of [true, false, true, true]) {
    opponent.activePet.currentHp = startingHp
    use(skill, undefined, hit)
  }
  expect(duringDamage).toEqual([false, false, true])
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
  const attack = 'skill_guangxiangongji_jiangtefang'
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
    owner.performSwitchPet(new SwitchPetContext(new TurnContext(battle), owner, pet))
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
  owner.activePet.damage(new DamageContext(cast, skill, owner.activePet, 20, DamageType.Physical, true))
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
  const strike = (damage: number) => target.damage(new DamageContext(cast, skill, target, damage, DamageType.Physical))
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
