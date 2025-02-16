#!/usr/bin/env node
import { program } from 'commander'
import path from 'path'
import fs from 'fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import yaml from 'yaml'
import { DataRepository } from '@/daraRespository/dataRepository'
import { PlayerParser, SpeciesParser, SkillParser, MarkParser, EffectParser } from '@/parser'
import { Battle } from '@/core/battle'
import { ConsoleUI } from '@/console/console'
import { Player } from '@/core/player'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 初始化游戏数据加载
async function loadGameData() {
  const dataDir = join(__dirname, '../../data')
  const files = await fs.readdir(dataDir)

  // 定义文件类型与处理逻辑的映射
  const handlers: Record<string, (content: string) => Promise<void>> = {
    species: async content => {
      const data = yaml.parse(content)
      for (const item of data) {
        const species = SpeciesParser.parse(item)
        DataRepository.getInstance().registerSpecies(species.id, species)
      }
    },
    skill: async content => {
      const data = yaml.parse(content)
      for (const item of data) {
        const skill = SkillParser.parse(item)
        DataRepository.getInstance().registerSkill(skill.id, skill)
      }
    },
    mark: async content => {
      const data = yaml.parse(content)
      for (const item of data) {
        const mark = MarkParser.parse(item)
        DataRepository.getInstance().registerMark(mark.id, mark)
      }
    },
    effect: async content => {
      const data = yaml.parse(content)
      for (const item of data) {
        const effect = EffectParser.parse(item) // 需要实现EffectParser
        DataRepository.getInstance().registerEffect(effect.id, effect)
      }
    },
    mark_ability: async content => {
      const data = yaml.parse(content)
      for (const item of data) {
        const mark = MarkParser.parse(item) // 需要修改MarkParser
        DataRepository.getInstance().registerMark(mark.id, mark)
      }
    },
    mark_emblem: async content => {
      const data = yaml.parse(content)
      for (const item of data) {
        const mark = MarkParser.parse(item) // 需要修改MarkParser
        DataRepository.getInstance().registerMark(mark.id, mark)
      }
    },
  }

  for (const file of files) {
    if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue

    // 提取文件名前缀（如 "species" from "species.yaml"）
    const [prefix] = file.split('.')
    const handler = handlers[prefix]

    if (!handler) {
      console.warn(`[⚠️] 未注册的文件类型: ${file}`)
      continue
    }

    try {
      const filePath = path.join(dataDir, file)
      const content = await fs.readFile(filePath, 'utf-8')
      await handler(content)
      console.log(`[✅] 成功加载: ${file}`)
    } catch (err) {
      console.error(`[💥] 加载失败 ${file}:`, err instanceof Error ? err.message : err)
      process.exit(1)
    }
  }
}

// 解析玩家文件
async function parsePlayerFile(filePath: string): Promise<Player> {
  try {
    const content = await fs.readFile(path.resolve(filePath), 'utf-8')
    const rawData = yaml.parse(content)
    return PlayerParser.parse(rawData)
  } catch (err) {
    throw new Error(`无法解析玩家文件 ${filePath}: ${err instanceof Error ? err.message : err}`)
  }
}

// 主程序
program
  .name('pokemon-battle')
  .description('精灵对战命令行工具')
  .requiredOption('-1, --player1 <path>', '玩家1数据文件路径')
  .requiredOption('-2, --player2 <path>', '玩家2数据文件路径')
  .action(async options => {
    try {
      // 步骤1: 加载游戏数据
      console.log('[🌀] 正在加载游戏数据...')
      await loadGameData()

      // 步骤2: 解析玩家数据
      console.log('[🌀] 正在解析玩家数据...')
      const player1 = await parsePlayerFile(options.player1)
      const player2 = await parsePlayerFile(options.player2)

      // 步骤3: 开始战斗
      console.log('[⚔️] 战斗开始！')
      const battle = new Battle(player1, player2, {
        allowFaintSwitch: true,
      })
      const consoleUI = new ConsoleUI(battle, player1, player2)
      await consoleUI.run()
    } catch (err) {
      console.error('[💥] 致命错误:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

program.parseAsync(process.argv)
