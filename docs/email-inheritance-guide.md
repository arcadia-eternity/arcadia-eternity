# 跨设备玩家ID继承功能使用指南

## 功能概述

跨设备玩家ID继承功能允许玩家**可选地**将其玩家ID与邮箱绑定，实现在不同设备间继承游戏数据。

### 用户模式

- **匿名用户**：默认模式，数据仅保存在本设备，无需注册即可使用
- **注册用户**：绑定邮箱后的用户，数据可跨设备同步和恢复

### 核心特性

- **可选注册**：保持匿名使用体验，绑定邮箱完全可选
- **一一对应关系**：每个邮箱只能绑定一个玩家ID，每个玩家ID只能绑定一个邮箱
- **邮箱验证**：通过6位数字验证码确保邮箱所有权
- **安全保护**：验证码有效期10分钟，发送频率限制1分钟
- **数据继承**：恢复玩家ID后可获得所有关联的游戏数据
- **状态转换**：可随时在匿名用户和注册用户间切换

## 使用流程

### 1. 绑定邮箱（匿名用户 → 注册用户）

1. 访问"账户管理"页面
2. 在"绑定邮箱（可选）"卡片中输入邮箱地址
3. 点击"发送验证码"
4. 查收邮件并输入6位验证码
5. 点击"确认绑定"完成绑定，成为注册用户

### 2. 恢复玩家ID

1. 在新设备上访问"账户管理"页面
2. 在"恢复玩家ID"卡片中输入已绑定的邮箱
3. 点击"发送验证码"
4. 查收邮件并输入6位验证码
5. 点击"恢复玩家ID"完成恢复

### 3. 转为匿名用户（注册用户 → 匿名用户）

1. 在"注册用户"卡片中点击"转为匿名用户"按钮
2. 确认转换操作
3. 转换后数据将仅保存在当前设备，可随时重新绑定邮箱

## 技术实现

### 数据库设计

#### 玩家表扩展

```sql
ALTER TABLE players 
ADD COLUMN email TEXT UNIQUE,
ADD COLUMN email_verified BOOLEAN DEFAULT FALSE,
ADD COLUMN email_bound_at TIMESTAMPTZ;
```

#### 邮箱验证码表

```sql
CREATE TABLE email_verification_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    player_id TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('bind', 'recover')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '10 minutes'),
    used_at TIMESTAMPTZ
);
```

### API 端点

- `POST /api/v1/email/send-verification-code` - 发送验证码
- `POST /api/v1/email/verify-code` - 验证验证码
- `POST /api/v1/email/bind` - 绑定邮箱
- `POST /api/v1/email/recover` - 恢复玩家ID
- `POST /api/v1/email/unbind` - 解绑邮箱
- `GET /api/v1/email/check-binding` - 检查邮箱绑定状态

### 前端组件

- `EmailInheritance.vue` - 邮箱继承主组件
- `accountPage.vue` - 账户管理页面
- `emailInheritanceService.ts` - API 服务封装

## 安全考虑

### 验证码安全

- 6位数字验证码，有效期10分钟
- 发送频率限制：同一邮箱1分钟内只能发送一次
- 验证码使用后立即标记为已使用

### 数据库安全

- 邮箱格式验证
- 唯一性约束确保一一对应关系
- RLS策略限制数据访问权限

### 前端安全

- 输入验证和格式检查
- 错误处理和用户友好提示
- 防止重复提交

## 部署配置

### 环境变量

```bash
# Supabase 配置（必需）
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_KEY=your_supabase_service_role_key

# 邮件服务配置（可选，开发环境输出到控制台）
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your_email@example.com
SMTP_PASS=your_password
```

### 数据库迁移

```bash
# 执行迁移脚本
psql -h your-host -U postgres -d postgres -f packages/database/sql/04_add_email_inheritance.sql
```

### 服务器启动

```bash
# 启动服务器（包含邮箱继承API）
node dist/cli.js server --port 8102
```

## 开发环境

在开发环境下，验证码会输出到服务器控制台，无需配置真实的邮件服务。

### 控制台输出示例

```text
邮箱验证码 [bind]: user@example.com -> 123456
邮箱验证码 [recover]: user@example.com -> 654321
```

## 生产环境

生产环境需要配置真实的邮件服务来发送验证码。建议使用：

- SendGrid
- AWS SES
- 阿里云邮件推送
- 腾讯云邮件服务

## 故障排除

### 常见问题

1. **验证码收不到**
   - 检查邮箱地址是否正确
   - 查看垃圾邮件文件夹
   - 确认邮件服务配置正确

2. **验证码无效**
   - 检查验证码是否过期（10分钟有效期）
   - 确认输入的验证码正确
   - 验证码只能使用一次

3. **邮箱已被绑定**
   - 每个邮箱只能绑定一个玩家ID
   - 如需更换，请先解绑原有绑定

4. **恢复失败**
   - 确认邮箱已绑定到某个玩家ID
   - 检查验证码是否正确
   - 确认网络连接正常

### 日志查看

```bash
# 查看服务器日志
tail -f logs/server.log

# 查看数据库日志
tail -f logs/database.log
```

## 更新日志

### v1.0.0

- 初始版本发布
- 支持邮箱绑定和恢复功能
- 完整的前端界面和API实现
- 安全验证和错误处理

## 相关文档

- [数据库设计文档](./database-design.md)
- [API 接口文档](./api-documentation.md)
- [部署指南](./deployment-guide.md)
