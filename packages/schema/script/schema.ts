import fs from 'fs/promises'
import path from 'path'
import { z } from 'zod'
import { MarkDataSetSchema, SkillDataSetSchema, SpeciesDataSetSchema } from '..'
import { EffectDSLSetSchema } from '@arcadia-eternity/schema'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// 获取当前文件的 __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 定义文件名前缀与 Zod Schema 的映射关系
const SCHEMA_MAP: Record<string, z.ZodSchema> = {
  mark: MarkDataSetSchema,
  skill: SkillDataSetSchema,
  species: SpeciesDataSetSchema,
  effect: EffectDSLSetSchema,
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
    const jsonSchema = z.toJSONSchema(schema, { io: 'input' })

    const schemaPath = path.join(schemaDir, schemaName)
    await fs.writeFile(schemaPath, JSON.stringify(jsonSchema, null, 2))
    console.log(`[📄] Generated schema: ${schemaPath}`)
  }
}
// 主流程
async function main() {
  try {
    await generateJsonSchema() // 先生成 Schema
  } catch (err) {
    console.error('[🔥] Fatal error:', err instanceof Error ? err.message : err)
    process.exit(1)
  }
}

// 执行
main()
