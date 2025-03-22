import fs from 'fs/promises'
import path, { dirname } from 'path'
import YAML from 'yaml'
import { DataRepository } from '@test-battle/data-repository'
import { extractMetadata } from '@test-battle/schema'
import { EffectParser, MarkParser, SkillParser, SpeciesParser } from '@test-battle/parser'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 增强类型定义
type FileCategory = 'effect' | 'mark' | 'skill' | 'species'

// 初始化数据仓库
const dataRepo = DataRepository.getInstance()

// 支持的文件前缀映射
const FILE_CATEGORIES: Record<string, FileCategory> = {
  effect: 'effect',
  mark: 'mark',
  skill: 'skill',
  species: 'species',
}

// 核心加载逻辑
async function loadDataFile(filePath: string, category: FileCategory) {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    const metadata = extractMetadata(content)

    // 元数据校验
    if (metadata.metaType !== category) {
      throw new Error(`元数据类型不匹配: 文件类型 ${category}, 元数据类型 ${metadata.metaType}`)
    }

    // YAML 解析
    const data = YAML.parse(content, {
      merge: true,
    })

    // 数据校验与注册
    switch (category) {
      case 'mark':
        for (const item of data) {
          const mark = MarkParser.parse({
            ...item,
            type: path.basename(filePath, '.yaml').split('_')[1] || 'base',
          })
          dataRepo.registerMark(mark.id, mark)
        }
        break
      case 'effect':
        for (const item of data) {
          const effect = EffectParser.parse(item)
          DataRepository.getInstance().registerEffect(effect.id, effect)
        }
        break
      case 'skill':
        for (const item of data) {
          const skill = SkillParser.parse(item)
          DataRepository.getInstance().registerSkill(skill.id, skill)
        }
        break
      case 'species':
        for (const item of data) {
          const species = SpeciesParser.parse(item)
          DataRepository.getInstance().registerSpecies(species.id, species)
        }
        break
    }

    console.log(`✅ 成功加载 ${path.basename(filePath)} (${data.length} 条记录)`)
  } catch (error) {
    console.error(`💥 加载失败 ${path.basename(filePath)}:`, error instanceof Error ? error.message : error)
    throw error // 向上传递错误
  }
}

export async function loadGameData(dataDir = path.join(__dirname, '../../../data')) {
  try {
    const files = await fs.readdir(dataDir)

    // 按类型分组文件
    const fileGroups: Record<FileCategory, string[]> = {
      effect: [],
      mark: [],
      skill: [],
      species: [],
    }

    // 分类文件到对应分组
    for (const file of files) {
      if (!/\.ya?ml$/.test(file)) continue

      const prefix = file.split(/[._]/)[0]
      const category = FILE_CATEGORIES[prefix]

      if (category && fileGroups[category]) {
        fileGroups[category].push(file)
      } else {
        console.warn(`⚠️ 忽略未注册类型文件: ${file}`)
      }
    }

    // 按指定顺序加载
    const loadOrder: FileCategory[] = ['effect', 'mark', 'skill', 'species']
    for (const category of loadOrder) {
      const categoryFiles = fileGroups[category]
      if (categoryFiles.length === 0) continue

      console.log(`⏳ 开始加载 ${category} 数据...`)
      await Promise.all(categoryFiles.map(file => loadDataFile(path.join(dataDir, file), category)))
      console.log(`✅ 完成加载 ${category} 数据`)
    }

    console.log('🎉 所有数据加载完成')
  } catch (error) {
    console.error('🔥 数据初始化失败:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
