// packages/devServer/devServer.ts
import express from 'express'
import fs from 'fs/promises'
import path from 'path'
import YAML from 'yaml'
import cors from 'cors'
import { EffectSetSchema, MarkDataSetSchema, SkillDataSetSchema, SpeciesDataSetSchema } from '@test-battle/schema'

const app = express()
app.use(cors())
app.use(express.json())

// 数据类型映射
const DATA_SCHEMA_MAP = {
  effect: EffectSetSchema,
  mark: MarkDataSetSchema,
  skill: SkillDataSetSchema,
  species: SpeciesDataSetSchema,
} as const

type SchemaType = keyof typeof DATA_SCHEMA_MAP

// 统一数据加载方法
async function loadDataFile<T>(type: SchemaType): Promise<T> {
  const filePath = path.join(__dirname, '../../data', `${type}.yaml`)
  const content = await fs.readFile(filePath, 'utf-8')
  return YAML.parse(content) as T
}

// 统一数据保存方法
async function saveDataFile(type: SchemaType, data: unknown): Promise<void> {
  const filePath = path.join(__dirname, '../../data', `${type}.yaml`)
  const yamlContent = YAML.stringify(data)
  await fs.writeFile(filePath, yamlContent)
}

// 数据路由中间件
app.get('/api/schema-types', (_, res) => {
  res.json(Object.keys(DATA_SCHEMA_MAP))
})

app.get('/api/data/:type', async (req, res) => {
  const type = req.params.type as unknown as SchemaType

  try {
    const data = await loadDataFile(type)
    const schema = DATA_SCHEMA_MAP[type]
    const parsed = schema.safeParse(data)

    if (!parsed.success) {
      return res.status(500).json({
        error: 'Invalid data format',
        details: parsed.error.errors,
      })
    }

    res.json(parsed.data)
  } catch (error) {
    res.status(500).json({ error: 'Failed to load data' })
  }
})

app.post('/api/data/:type', async (req, res) => {
  const type = req.params.type as unknown as SchemaType
  const schema = DATA_SCHEMA_MAP[type]

  // Zod 数据验证
  const parseResult = schema.safeParse(req.body)
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Validation failed',
      details: parseResult.error.errors.map(e => ({
        path: e.path.join('.'),
        code: e.code,
        message: e.message,
      })),
    })
  }

  try {
    await saveDataFile(type, parseResult.data)
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: 'Failed to save data' })
  }
})

// 开发模式专用端点
if (process.env.NODE_ENV === 'development') {
  // 实时验证测试端点
  app.post('/api/validate/:type', (req, res) => {
    const type = req.params.type as unknown as SchemaType
    const schema = DATA_SCHEMA_MAP[type]
    const result = schema.safeParse(req.body)

    res.json({
      valid: result.success,
      errors: result.success ? [] : result.error.errors,
    })
  })

  // 数据快照管理
  app.post('/api/snapshot/:type', async (req, res) => {
    const type = req.params.type as unknown as SchemaType
    const snapshotDir = path.join(__dirname, '../../data/snapshots')

    try {
      const data = await loadDataFile(type)
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const snapshotPath = path.join(snapshotDir, `${type}-${timestamp}.yaml`)

      await fs.mkdir(snapshotDir, { recursive: true })
      await fs.writeFile(snapshotPath, YAML.stringify(data))

      res.json({ success: true, path: snapshotPath })
    } catch (error) {
      res.status(500).json({ error: 'Snapshot failed' })
    }
  })
}

// 启动服务器
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`DevServer running on http://localhost:${PORT}`)
})
