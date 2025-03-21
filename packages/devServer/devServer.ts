import { DATA_SCHEMA_MAP, type FileMetadata, MetadataSchema, type SchemaType } from '@test-battle/schema'
import cors from 'cors'
import express from 'express'
import fs from 'fs/promises'
import path, { dirname } from 'path'
import { fileURLToPath } from 'url'
import pino from 'pino'
import YAML from 'yaml'
import { z } from 'zod'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  formatters: {
    level: label => ({ level: label }),
  },
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
})

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

class DevServer {
  private app: express.Application
  private port: number | string

  constructor(app = express(), port: number | string = 7891) {
    this.app = app
    this.port = port || process.env.PORT || 7891

    this.configureMiddleware()
    this.configureRoutes()
  }

  // 中间件配置
  private configureMiddleware(): void {
    this.app.use(cors())
    this.app.use(express.json())
    logger.info('Middleware initialized')
  }

  // 路由配置
  private configureRoutes(): void {
    this.app.get('/api/files', this.handleGetFiles.bind(this))
    this.app.get('/api/file/:filename', this.handleGetFile.bind(this))
    this.app.post('/api/file/:filename', this.handleSaveFile.bind(this))
    this.app.get('/api/data/:type', this.handleLegacyEndpoint.bind(this))
  }

  private async readFileWithMetadata(filePath: string) {
    try {
      logger.debug('Reading file: %s', filePath)
      const content = await fs.readFile(filePath, 'utf-8')
      const metadataLines: string[] = []
      const preservedComments: string[] = [] // 新增保留注释集合
      let dataContent = ''

      content.split('\n').forEach(line => {
        if (line.startsWith('# @')) {
          metadataLines.push(line)
        } else if (line.startsWith('#')) {
          // 捕获其他注释
          preservedComments.push(line)
        } else {
          dataContent += line + '\n'
        }
      })

      return {
        metadata: MetadataSchema.parse(
          Object.fromEntries(
            metadataLines.map(line => {
              const [key, ...values] = line.replace('# @', '').split(/\s+/)
              return [key, values.join(' ')]
            }),
          ),
        ),
        preservedComments, // 返回需要保留的注释
        data: YAML.parse(dataContent),
      }
    } catch (error) {
      logger.error('Failed to read file %s: %s', filePath, error)
      throw error
    }
  }

  private async writeFileWithMetadata(
    filePath: string,
    metadata: FileMetadata,
    data: any,
    preservedComments: string[], // 新增保留注释参数
  ) {
    try {
      logger.debug('Writing file: %s', filePath)
      // 合并保留注释和新元数据
      const fullContent = [
        ...preservedComments,
        ...Object.entries(metadata).map(([k, v]) => `# @${k} ${v}`),
        '',
        YAML.stringify(data),
      ].join('\n')

      await fs.writeFile(filePath, fullContent)
      // ...原有逻辑不变
      logger.info('File saved successfully: %s', filePath)
    } catch (error) {
      logger.error('Failed to write file %s: %s', filePath, error)
      throw error
    }
  }

  private async handleGetFiles(_: express.Request, res: express.Response) {
    try {
      logger.debug('Fetching file list')
      const files = await fs.readdir(path.join(__dirname, '../../data'))
      const yamlFiles = files.filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
      logger.info('Found %d YAML files', yamlFiles.length)
      res.json(yamlFiles)
    } catch (error) {
      logger.error('Failed to list files: %s', error)
      res.status(500).json({ error: '无法读取文件列表', details: error })
    }
  }

  private async handleGetFile(req: express.Request, res: express.Response) {
    const filename = req.params.filename
    try {
      logger.debug('Processing file request: %s', filename)
      const filePath = path.join(__dirname, '../../data', req.params.filename)
      // 获取保留注释
      const { metadata, preservedComments, data } = await this.readFileWithMetadata(filePath)
      const schemaType = metadata.metaType as SchemaType
      const parsed = DATA_SCHEMA_MAP[schemaType].safeParse(data)

      // 返回保留注释给客户端
      parsed.success
        ? res.json({ metadata, preservedComments, data: parsed.data })
        : res.status(500).json({ error: '文件内容验证失败', details: parsed.error.errors })
      logger.info('File loaded successfully: %s', filename)
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.error('Validation failed for %s: %j', filename, error.errors)
      } else {
        logger.error('Error processing %s: %s', filename, error)
      }
      throw error
    }
  }

  private async handleSaveFile(req: express.Request, res: express.Response) {
    const filename = req.params.filename
    try {
      logger.debug('Processing save request: %s', filename)
      const { metadata, data, preservedComments = [] } = req.body
      const validatedMetadata = MetadataSchema.parse(metadata)
      const schemaType = validatedMetadata.metaType as SchemaType
      const validatedData = DATA_SCHEMA_MAP[schemaType].parse(data)

      const filePath = path.join(__dirname, '../../data', req.params.filename)
      // 写入时携带保留注释
      await this.writeFileWithMetadata(filePath, validatedMetadata, validatedData, preservedComments)

      res.json({ success: true })
      logger.info('File saved successfully: %s', filename)
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.error('Save validation failed for %s: %j', filename, error.errors)
        res.status(400).json({
          error: '验证失败',
          details: error.errors.map(e => ({
            path: e.path.join('.'),
            code: e.code,
            message: e.message,
          })),
        })
      } else {
        logger.error('Save failed for %s: %s', filename, error)
        res.status(500).json({ error: '文件保存失败' })
      }
    }
  }

  private handleLegacyEndpoint(req: express.Request, res: express.Response) {
    const type = req.params.type as SchemaType
    res.redirect(`/api/file/${type}.yaml`)
  }

  // 服务启动方法
  public start(): void {
    process.on('uncaughtException', error => {
      logger.error('Uncaught Exception: %s', error)
      process.exit(1)
    })

    process.on('unhandledRejection', reason => {
      logger.error('Unhandled Rejection: %s', reason)
      process.exit(1)
    })

    this.app.listen(this.port, () => {
      logger.info('Server started on port %d', this.port)
      logger.debug('Debug mode enabled')
    })
  }
}

if (import.meta.url.endsWith(process.argv[1])) {
  const server = new DevServer()
  server.start()
}

export default DevServer
