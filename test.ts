import { ConsoleUI } from './src/consoleUI'
import { BattleActions } from './src/effectBuilder/operator'
import { BattleTarget, BattleAttributes } from './src/effectBuilder/selector'
import { BattleSystem } from './src/simulation/battleSystem'
import { AttackTargetOpinion } from './src/simulation/const'
import { Effect, EffectTrigger } from './src/simulation/effect'
import { Mark } from './src/simulation/mark'
import { Nature } from './src/simulation/nature'
import { Species, Pet } from './src/simulation/pet'
import { Player } from './src/simulation/player'
import { Skill, SkillType } from './src/simulation/skill'
import { Type } from './src/simulation/type'

const burn = new Mark(
  'burn',
  '烧伤',
  [
    new Effect(
      'shaoshang',
      EffectTrigger.TurnEnd,
      BattleTarget.self.apply(
        BattleActions.dealDamage(BattleTarget.self.select(BattleAttributes.maxhp).divide(1).build()),
      ),
      0,
    ),
  ],
  {
    duration: 3,
    persistent: false,
  },
)

const penshehuoyan = new Skill(
  'penshehuoyan',
  '喷射火焰',
  SkillType.Physical,
  Type.Fire,
  80,
  1,
  15,
  0,
  AttackTargetOpinion.opponent,
  false,
  [new Effect('addBurn', EffectTrigger.PostDamage, BattleTarget.foe.apply(BattleActions.addMark(burn)), 1)],
)

// 妙蛙草系列
const venusaurSpecies: Species = {
  id: 'miaowahua',
  name: '妙蛙草',
  type: Type.Grass,
  baseStats: {
    hp: 160,
    atk: 82,
    def: 83,
    spa: 100,
    spd: 100,
    spe: 80,
  },
  skills: [],
}

const venusaur: Pet = new Pet(
  '叶之守护',
  venusaurSpecies,
  50,
  {
    hp: 252,
    atk: 0,
    def: 128,
    spa: 128,
    spd: 0,
    spe: 0,
  },
  {
    hp: 31,
    atk: 31,
    def: 31,
    spa: 31,
    spd: 31,
    spe: 31,
  },
  Nature.Modest,
  [penshehuoyan, new Skill('jishengzhongzi', '寄生种子', SkillType.Status, Type.Grass, 0, 1, 20, 1)],
)

// 皮卡丘系列
const pikachuSpecies: Species = {
  id: 'pikaqiu',
  name: '皮卡丘',
  type: Type.Electric,
  baseStats: {
    hp: 35,
    atk: 55,
    def: 40,
    spa: 50,
    spd: 50,
    spe: 90,
  },
  skills: [],
}

const thunderPikachu: Pet = new Pet(
  '闪电小子',
  pikachuSpecies,
  50,
  {
    hp: 0,
    atk: 0,
    def: 0,
    spa: 252,
    spd: 4,
    spe: 252,
  },
  {
    hp: 31,
    atk: 31,
    def: 31,
    spa: 31,
    spd: 31,
    spe: 31,
  },
  Nature.Timid,
  [
    new Skill('shiwanfute', '十万伏特', SkillType.Special, Type.Electric, 90, 1, 15, 1),
    new Skill('dianguangyishan', '电光一闪', SkillType.Physical, Type.Normal, 40, 1, 30, 1),
  ],
)

// 耿鬼系列
const gengarSpecies: Species = {
  id: 'genggui',
  name: '耿鬼',
  type: Type.Shadow,
  baseStats: {
    hp: 60,
    atk: 65,
    def: 60,
    spa: 130,
    spd: 75,
    spe: 110,
  },
  skills: [],
}

const shadowGengar: Pet = new Pet(
  '暗影行者',
  gengarSpecies,
  50,
  {
    hp: 0,
    atk: 0,
    def: 0,
    spa: 252,
    spd: 4,
    spe: 252,
  },
  {
    hp: 31,
    atk: 31,
    def: 31,
    spa: 31,
    spd: 31,
    spe: 31,
  },
  Nature.Timid,
  [
    new Skill('anyingqiu', '暗影球', SkillType.Special, Type.Shadow, 80, 1, 15, 0),
    new Skill('wunizhadan', '污泥炸弹', SkillType.Special, Type.Grass, 90, 1, 10, 0),
  ],
)

// 快龙系列
const dragoniteSpecies: Species = {
  id: 'kuailong',
  name: '快龙',
  type: Type.Dragon,
  baseStats: {
    hp: 91,
    atk: 134,
    def: 95,
    spa: 100,
    spd: 100,
    spe: 80,
  },
  skills: [],
}

const stormDragon: Pet = new Pet(
  '暴风龙',
  dragoniteSpecies,
  50,
  {
    hp: 0,
    atk: 252,
    def: 0,
    spa: 0,
    spd: 4,
    spe: 252,
  },
  {
    hp: 31,
    atk: 31,
    def: 31,
    spa: 31,
    spd: 31,
    spe: 31,
  },
  Nature.Adamant,
  [penshehuoyan, new Skill('shensu', '神速', SkillType.Physical, Type.Normal, 80, 1, 5, 2)],
)

const player2 = new Player('小茂', stormDragon, [stormDragon, shadowGengar])
const player1 = new Player('小智', venusaur, [venusaur, thunderPikachu])

const battle = new BattleSystem(player1, player2, {
  allowKillerSwitch: true,
})
const consoleui = new ConsoleUI(battle, player1, player2)
consoleui.run()
