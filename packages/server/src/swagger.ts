import swaggerJSDoc from 'swagger-jsdoc'
import type { Options } from 'swagger-jsdoc'

/**
 * Swagger/OpenAPI 配置
 */
const swaggerOptions: Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Arcadia Eternity Battle Server API',
      version: '1.0.0',
      description: '永恒阿卡迪亚战斗服务器 API 文档',
      contact: {
        name: 'API Support',
        email: 'support@yuuinih.com',
      },
    },
    servers: [
      {
        url: 'http://localhost:8102',
        description: '开发服务器',
      },
      {
        url: 'https://battle.yuuinih.com',
        description: '生产服务器',
      },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT访问令牌，仅注册用户需要',
        },
      },
      schemas: {
        // 通用响应模式
        SuccessResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true,
            },
            message: {
              type: 'string',
              example: '操作成功',
            },
            data: {
              type: 'object',
              description: '响应数据',
            },
          },
          required: ['success'],
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false,
            },
            message: {
              type: 'string',
              example: '操作失败',
            },
            code: {
              type: 'string',
              example: 'ERROR_CODE',
            },
            error: {
              type: 'string',
              example: 'Detailed error message',
            },
          },
          required: ['success', 'message'],
        },
        // 分页参数
        PaginationQuery: {
          type: 'object',
          properties: {
            page: {
              type: 'integer',
              minimum: 1,
              default: 1,
              description: '页码',
            },
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 100,
              default: 20,
              description: '每页数量',
            },
          },
        },
        PaginatedResponse: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: {},
              description: '数据列表',
            },
            pagination: {
              type: 'object',
              properties: {
                page: {
                  type: 'integer',
                  description: '当前页码',
                },
                limit: {
                  type: 'integer',
                  description: '每页数量',
                },
                total: {
                  type: 'integer',
                  description: '总数量',
                },
                totalPages: {
                  type: 'integer',
                  description: '总页数',
                },
              },
              required: ['page', 'limit', 'total', 'totalPages'],
            },
          },
          required: ['data', 'pagination'],
        },
        // 健康检查响应
        HealthResponse: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              example: 'ok',
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
              example: '2024-01-01T00:00:00.000Z',
            },
            uptime: {
              type: 'number',
              example: 3600.5,
              description: '服务器运行时间（秒）',
            },
          },
          required: ['status', 'timestamp', 'uptime'],
        },
        // 服务器统计响应
        ServerStats: {
          type: 'object',
          properties: {
            activeConnections: {
              type: 'integer',
              description: '活跃连接数',
            },
            totalBattles: {
              type: 'integer',
              description: '总战斗数',
            },
            activeBattles: {
              type: 'integer',
              description: '进行中的战斗数',
            },
            uptime: {
              type: 'number',
              description: '服务器运行时间（秒）',
            },
          },
        },
        // 玩家相关模式
        Player: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: '玩家ID',
            },
            name: {
              type: 'string',
              description: '玩家名称',
            },
            email: {
              type: 'string',
              format: 'email',
              description: '邮箱地址（可选）',
            },
            isRegistered: {
              type: 'boolean',
              description: '是否为注册用户',
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              description: '创建时间',
            },
            updatedAt: {
              type: 'string',
              format: 'date-time',
              description: '更新时间',
            },
          },
          required: ['id', 'name', 'isRegistered'],
        },
        PlayerStats: {
          type: 'object',
          properties: {
            playerId: {
              type: 'string',
              description: '玩家ID',
            },
            totalBattles: {
              type: 'integer',
              description: '总战斗数',
            },
            wins: {
              type: 'integer',
              description: '胜利数',
            },
            losses: {
              type: 'integer',
              description: '失败数',
            },
            winRate: {
              type: 'number',
              format: 'float',
              description: '胜率',
            },
          },
          required: ['playerId', 'totalBattles', 'wins', 'losses', 'winRate'],
        },
        // 战报相关模式
        BattleRecord: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: '战报ID',
            },
            player1Id: {
              type: 'string',
              description: '玩家1 ID',
            },
            player2Id: {
              type: 'string',
              description: '玩家2 ID',
            },
            winnerId: {
              type: 'string',
              description: '获胜者ID',
              nullable: true,
            },
            battleData: {
              type: 'object',
              description: '战斗数据',
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              description: '创建时间',
            },
          },
          required: ['id', 'player1Id', 'player2Id', 'battleData', 'createdAt'],
        },
        BattleStatistics: {
          type: 'object',
          properties: {
            totalBattles: {
              type: 'integer',
              description: '总战斗数',
            },
            totalPlayers: {
              type: 'integer',
              description: '总玩家数',
            },
            averageBattleDuration: {
              type: 'number',
              description: '平均战斗时长（秒）',
            },
          },
        },
        // 认证相关模式
        AuthTokens: {
          type: 'object',
          properties: {
            accessToken: {
              type: 'string',
              description: 'JWT访问令牌',
            },
            refreshToken: {
              type: 'string',
              description: '刷新令牌',
            },
            expiresIn: {
              type: 'integer',
              description: '访问令牌过期时间（秒）',
            },
          },
          required: ['accessToken', 'refreshToken', 'expiresIn'],
        },
        AuthResult: {
          type: 'object',
          properties: {
            player: {
              $ref: '#/components/schemas/Player',
            },
            tokens: {
              $ref: '#/components/schemas/AuthTokens',
            },
          },
          required: ['player', 'tokens'],
        },
        // 邮箱验证相关模式
        SendVerificationRequest: {
          type: 'object',
          properties: {
            email: {
              type: 'string',
              format: 'email',
              description: '邮箱地址',
            },
            playerId: {
              type: 'string',
              description: '玩家ID（恢复时可选）',
            },
            purpose: {
              type: 'string',
              enum: ['bind', 'recover'],
              description: '验证目的：bind-绑定邮箱，recover-恢复玩家ID',
            },
          },
          required: ['email', 'purpose'],
        },
        VerifyAndBindRequest: {
          type: 'object',
          properties: {
            email: {
              type: 'string',
              format: 'email',
              description: '邮箱地址',
            },
            code: {
              type: 'string',
              description: '验证码',
            },
            playerId: {
              type: 'string',
              description: '要绑定的玩家ID',
            },
          },
          required: ['email', 'code', 'playerId'],
        },
        VerifyAndRecoverRequest: {
          type: 'object',
          properties: {
            email: {
              type: 'string',
              format: 'email',
              description: '邮箱地址',
            },
            code: {
              type: 'string',
              description: '验证码',
            },
          },
          required: ['email', 'code'],
        },
      },
    },
    tags: [
      {
        name: 'Health',
        description: '健康检查和服务器状态',
      },
      {
        name: 'Battle Reports',
        description: '战报相关API',
      },
      {
        name: 'Players',
        description: '玩家相关API',
      },
      {
        name: 'Authentication',
        description: '认证相关API',
      },
      {
        name: 'Email',
        description: '邮箱继承相关API',
      },
    ],
  },
  apis: ['./src/app.ts', './src/battleReportRoutes.ts', './src/authRoutes.ts', './src/emailInheritanceRoutes.ts'],
}

/**
 * 生成Swagger规范
 */
export const swaggerSpec = swaggerJSDoc(swaggerOptions)

/**
 * Swagger UI 配置选项
 */
export const swaggerUiOptions = {
  explorer: true,
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: true,
    showExtensions: true,
    showCommonExtensions: true,
  },
}
