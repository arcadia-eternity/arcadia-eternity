import { Type } from './src/type'
import { Skill, SkillType } from './src/skill'
import { Pet } from './src/pet'
import { BattleSystem, Player } from './src/battleSystem'
import { Species } from './src/pet'
import { Nature } from './src/nature'
import { ConsoleUI } from './src/consoleUI'
// 使用示例

// 妙蛙草系列
const venusaurSpecies: Species = {
  name: '妙蛙草',
  type: Type.Grass,
  baseStats: {
    hp: 80,
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
  [
    new Skill('强力鞭打', SkillType.Physical, Type.Grass, 120, 0.85, 10, 1),
    new Skill('寄生种子', SkillType.Status, Type.Grass, 0, 1, 20, 1),
  ],
)

// 皮卡丘系列
const pikachuSpecies: Species = {
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
    new Skill('十万伏特', SkillType.Special, Type.Electric, 90, 1, 15, 1),
    new Skill('电光一闪', SkillType.Physical, Type.Normal, 40, 1, 30, 1),
  ],
)

// 耿鬼系列
const gengarSpecies: Species = {
  name: '耿鬼',
  type: Type.Ghost,
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
    new Skill('暗影球', SkillType.Special, Type.Ghost, 80, 1, 15, 1),
    new Skill('污泥炸弹', SkillType.Special, Type.Poison, 90, 1, 10, 1),
  ],
)

// 快龙系列
const dragoniteSpecies: Species = {
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
  [
    new Skill('龙爪', SkillType.Physical, Type.Dragon, 80, 1, 15, 1),
    new Skill('神速', SkillType.Physical, Type.Normal, 80, 1, 5, 1),
  ],
)

const player2 = new Player('小茂', stormDragon, [stormDragon, shadowGengar])
const player1 = new Player('小智', venusaur, [venusaur, thunderPikachu])

const battle = new BattleSystem(player1, player2)
const consoleui = new ConsoleUI(battle, player1, player2)
consoleui.run()
