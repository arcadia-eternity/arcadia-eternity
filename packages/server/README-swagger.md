# Swagger API 文档

本项目已为 Arcadia Eternity Battle Server 添加了完整的 Swagger/OpenAPI 3.0 文档。

## 功能特性

- ✅ **完整的 API 文档**: 覆盖所有 REST API 端点
- ✅ **交互式 UI**: 可直接在浏览器中测试 API
- ✅ **类型安全**: 基于现有的 Zod 模式定义
- ✅ **认证支持**: 支持 JWT Bearer Token 认证
- ✅ **多环境配置**: 开发和生产环境服务器配置
- ✅ **详细的错误响应**: 包含所有可能的错误情况

## 访问方式

### 1. Swagger UI 界面

```
http://localhost:8102/api-docs
```

提供交互式的 API 文档界面，可以直接测试 API 端点。

### 2. OpenAPI JSON 规范

```
http://localhost:8102/api-docs.json
```

返回完整的 OpenAPI 3.0 JSON 规范，可用于代码生成或其他工具。

## API 端点分类

### 🏥 Health (健康检查)

- `GET /health` - 服务器健康检查
- `GET /api/stats` - 服务器统计信息

### 📊 Battle Reports (战报)

- `GET /api/v1/battles` - 获取战报列表（分页）
- `GET /api/v1/battles/{id}` - 获取单个战报详情
- `GET /api/v1/statistics` - 获取战报统计信息

### 👥 Players (玩家)

- `GET /api/v1/players/{playerId}` - 获取玩家信息
- `GET /api/v1/players/{playerId}/stats` - 获取玩家统计
- `GET /api/v1/players` - 搜索玩家

### 🔐 Authentication (认证)

- `POST /api/v1/auth/refresh` - 刷新访问令牌
- `GET /api/v1/auth/verify` - 验证令牌有效性

### 📧 Email (邮箱继承)

- `POST /api/v1/email/send-verification-code` - 发送验证码
- `POST /api/v1/email/bind` - 绑定邮箱
- `POST /api/v1/email/recover` - 恢复玩家ID

## 认证说明

### 游客模式

大部分 API 端点支持游客模式访问，无需认证。

### 注册用户认证

注册用户需要在请求头中提供 JWT 令牌：

```
Authorization: Bearer <your-jwt-token>
```

在 Swagger UI 中，点击右上角的 "Authorize" 按钮输入令牌。

## 数据模式

### 通用响应格式

```json
{
  "success": true,
  "message": "操作成功",
  "data": { ... }
}
```

### 错误响应格式

```json
{
  "success": false,
  "message": "错误描述",
  "code": "ERROR_CODE"
}
```

### 分页响应格式

```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

## 开发指南

### 添加新的 API 端点

1. **在路由文件中添加 JSDoc 注释**:

```javascript
/**
 * @swagger
 * /api/v1/your-endpoint:
 *   get:
 *     tags: [Your Tag]
 *     summary: 端点描述
 *     description: 详细描述
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 成功响应
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/YourSchema'
 */
```

2. **在 swagger.ts 中添加新的模式定义**:

```javascript
YourSchema: {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' }
  },
  required: ['id', 'name']
}
```

3. **重新构建项目**:

```bash
pnpm run build
```

### 测试 Swagger 配置

运行测试脚本验证配置：

```bash
node test-swagger-simple.js
```

启动测试服务器：

```bash
node test-swagger.js
```

## 配置选项

### Swagger UI 配置

在 `swagger.ts` 中的 `swaggerUiOptions` 对象中配置：

- `explorer`: 启用 API 探索器
- `persistAuthorization`: 持久化认证信息
- `displayRequestDuration`: 显示请求耗时
- `filter`: 启用过滤功能

### 服务器配置

在 `swaggerOptions.definition.servers` 中配置不同环境的服务器地址。

## 注意事项

1. **生产环境**: 确保在生产环境中正确配置服务器 URL
2. **安全性**: API 文档可能暴露敏感信息，考虑在生产环境中限制访问
3. **版本控制**: 当 API 发生重大变更时，记得更新版本号
4. **文档同步**: 确保 Swagger 文档与实际 API 实现保持同步

## 故障排除

### 常见问题

1. **Swagger UI 无法加载**
   - 检查服务器是否正常启动
   - 确认端口配置正确
   - 查看浏览器控制台错误信息

2. **API 端点未显示**
   - 确认 JSDoc 注释格式正确
   - 检查路由文件是否在 `swagger.ts` 的 `apis` 数组中
   - 重新构建项目

3. **认证失败**
   - 确认 JWT 令牌格式正确
   - 检查令牌是否过期
   - 验证 Bearer 前缀是否正确

## 相关文件

- `src/swagger.ts` - Swagger 配置文件
- `src/app.ts` - Swagger 中间件集成
- `src/*Routes.ts` - 各路由文件中的 API 文档注释
- `test-swagger.js` - 测试服务器脚本
- `test-swagger-simple.js` - 配置验证脚本
