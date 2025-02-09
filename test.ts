import { ConsoleUI } from './src/console/console'
import { BattleActions } from './src/effectBuilder/operator'
import { BattleTarget, BattleAttributes } from './src/effectBuilder/selector'
import { BattleSystem } from './src/core/battleSystem'
import { AttackTargetOpinion } from './src/core/const'
import { Effect, EffectTrigger } from './src/core/effect'
import { Mark } from './src/core/mark'
import { Nature } from './src/core/nature'
import { Species, Pet } from './src/core/pet'
import { Player } from './src/core/player'
import { Skill, Category } from './src/core/skill'
import { Element } from './src/core/element'

const burn = new Mark(
  'burn',
  '烧伤',
  [
    new Effect(
      'shaoshang',
      EffectTrigger.TurnEnd,
      BattleTarget.self.apply(BattleActions.dealDamage(BattleTarget.self.select(BattleAttributes.maxhp).divide(8))),
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
  Category.Physical,
  Element.Fire,
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
  type: Element.Grass,
  baseStats: {
    hp: 160,
    atk: 82,
    def: 83,
    spa: 100,
    spd: 100,
    spe: 80,
  },
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
  [penshehuoyan, new Skill('jishengzhongzi', '寄生种子', Category.Status, Element.Grass, 0, 1, 20, 1)],
)

// 皮卡丘系列
const pikachuSpecies: Species = {
  id: 'pikaqiu',
  name: '皮卡丘',
  type: Element.Electric,
  baseStats: {
    hp: 35,
    atk: 55,
    def: 40,
    spa: 50,
    spd: 50,
    spe: 90,
  },
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
    new Skill('shiwanfute', '十万伏特', Category.Special, Element.Electric, 90, 1, 15, 1),
    new Skill('dianguangyishan', '电光一闪', Category.Physical, Element.Normal, 40, 1, 30, 1),
  ],
)

// 耿鬼系列
const gengarSpecies: Species = {
  id: 'genggui',
  name: '耿鬼',
  type: Element.Shadow,
  baseStats: {
    hp: 60,
    atk: 65,
    def: 60,
    spa: 130,
    spd: 75,
    spe: 110,
  },
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
    new Skill('anyingqiu', '暗影球', Category.Special, Element.Shadow, 80, 1, 15, 0),
    new Skill('wunizhadan', '污泥炸弹', Category.Special, Element.Grass, 90, 1, 10, 0),
  ],
)

// 快龙系列
const dragoniteSpecies: Species = {
  id: 'kuailong',
  name: '快龙',
  type: Element.Dragon,
  baseStats: {
    hp: 91,
    atk: 134,
    def: 95,
    spa: 100,
    spd: 100,
    spe: 80,
  },
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
  [penshehuoyan, new Skill('shensu', '神速', Category.Physical, Element.Normal, 80, 1, 5, 2)],
)

const player2 = new Player('小茂', stormDragon, [stormDragon, shadowGengar])
const player1 = new Player('小智', venusaur, [venusaur, thunderPikachu])

const battle = new BattleSystem(player1, player2, {
  allowKillerSwitch: true,
})
const consoleui = new ConsoleUI(battle, player1, player2)
consoleui.run()
