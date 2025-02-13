import fs from 'fs/promises'
import path from 'path'
import yaml from 'yaml'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { MarkDataSetSchema, SkillDataSetSchema, SpeciesDataSetSchema } from '../src/schema'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// 获取当前文件的 __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 定义文件名前缀与 Zod Schema 的映射关系
const SCHEMA_MAP: Record<string, z.ZodSchema> = {
  mark: MarkDataSetSchema,
  mark_ability: MarkDataSetSchema,
  mark_emblem: MarkDataSetSchema,
  skill: SkillDataSetSchema,
  species: SpeciesDataSetSchema,
}

// 创建目录（如果不存在）
async function ensureDir(dirPath: string) {
  try {
    await fs.access(dirPath)
  } catch {
    await fs.mkdir(dirPath, { recursive: true })
  }
}

// 生成 JSON Schema 并保存到文件
async function generateJsonSchema() {
  const schemaDir = join(__dirname, '../schema')
  await ensureDir(schemaDir)

  // 为每个 Schema 生成独立的 JSON Schema 文件
  const uniqueSchemas = new Map<string, z.ZodSchema>()
  Object.entries(SCHEMA_MAP).forEach(([prefix, schema]) => {
    const schemaName = `${prefix}.schema.json`
    if (!uniqueSchemas.has(schemaName)) {
      uniqueSchemas.set(schemaName, schema)
    }
  })

  for (const [schemaName, schema] of uniqueSchemas) {
    const jsonSchema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      ...zodToJsonSchema(schema, {
        name: schemaName.replace('.schema.json', ''),
        errorMessages: true, // 启用错误信息（如果库支持）
      }),
    }

    const schemaPath = path.join(schemaDir, schemaName)
    await fs.writeFile(schemaPath, JSON.stringify(jsonSchema, null, 2))
    console.log(`[📄] Generated schema: ${schemaPath}`)
  }
}

// 校验 YAML 文件数据
async function validateYamlFiles() {
  const dataDir = path.join(__dirname, '../data')
  const files = await fs.readdir(dataDir)

  for (const file of files) {
    if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue

    const [prefix] = file.split('.')
    const schema = SCHEMA_MAP[prefix]

    if (!schema) {
      console.warn(`[⚠️] No schema found for ${file}`)
      continue
    }

    try {
      const filePath = path.join(dataDir, file)
      const content = await fs.readFile(filePath, 'utf-8')
      const data = yaml.parse(content)

      // 执行严格校验
      const result = schema.safeParse(data)

      if (!result.success) {
        console.error(`[❌] Validation failed for ${file}:`)
        result.error.errors.forEach(err => {
          console.error(`  - ${err.path.join('.')}: ${err.message}`)
        })
        process.exitCode = 1
      } else {
        console.log(`[✅] Successfully validated ${file}`)
      }
    } catch (err) {
      console.error(`[💥] Error processing ${file}:`, err instanceof Error ? err.message : err)
      process.exitCode = 1
    }
  }
}

// 主流程
async function main() {
  try {
    await generateJsonSchema() // 先生成 Schema
    await validateYamlFiles() // 再校验数据
  } catch (err) {
    console.error('[🔥] Fatal error:', err instanceof Error ? err.message : err)
    process.exit(1)
  }
}

// 执行
main()
