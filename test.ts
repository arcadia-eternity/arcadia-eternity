import { Type } from './src/type'
import { Skill, SkillType } from './src/skill'
import { Pet } from './src/pet'
import { BattleSystem, Player } from './src/battleSystem'
import { Species } from './src/pet'
import { Nature } from './src/nature'
import { ConsoleUI } from './src/consoleUI'
// 使用示例

const charizardSpecies: Species = {
  name: '休罗斯',
  type: Type.Fire,
  baseStats: {
    hp: 78,
    atk: 84,
    def: 78,
    spa: 109,
    spd: 85,
    spe: 100,
  },
  skills: [],
}

const charizard: Pet = new Pet(
  '火狗',
  charizardSpecies,
  50,
  {
    hp: 255,
    atk: 0,
    def: 0,
    spa: 255,
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
  Nature.Adamant,
  [
    new Skill('火焰拳', SkillType.Physical, Type.Fire, 75, 1, 20, 1),
    new Skill('飞翔', SkillType.Physical, Type.Flying, 25, 1, 5, 1),
  ],
)

const charizard2: Pet = new Pet(
  '火狗2',
  charizardSpecies,
  50,
  {
    hp: 255,
    atk: 0,
    def: 0,
    spa: 255,
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
  Nature.Adamant,
  [
    new Skill('火焰拳', SkillType.Physical, Type.Fire, 75, 1, 20, 1),
    new Skill('飞翔', SkillType.Physical, Type.Flying, 25, 1, 5, 1),
  ],
)

const blastoiseSpecies: Species = {
  name: '迪兰特',
  type: Type.Water,
  baseStats: {
    hp: 79,
    atk: 83,
    def: 100,
    spa: 85,
    spd: 105,
    spe: 78,
  },
  skills: [],
}

const blastoise = new Pet(
  '迪兰特',
  blastoiseSpecies,
  50,
  {
    hp: 255,
    atk: 0,
    def: 0,
    spa: 255,
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
  Nature.Adamant,
  [new Skill('水枪', SkillType.Special, Type.Water, 160, 1, 100, 1)],
)

const player2 = new Player('小茂', charizard, [charizard, charizard2])
const player1 = new Player('小智', blastoise, [blastoise])

const battle = new BattleSystem(player1, player2)
const consoleui = new ConsoleUI(battle, player1, player2)
consoleui.run()
