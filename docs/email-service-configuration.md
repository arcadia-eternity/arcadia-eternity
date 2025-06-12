# 邮件服务配置指南

## 概述

邮件服务支持多种邮件提供商，包括SMTP、SendGrid、AWS SES等。系统会根据环境变量自动选择合适的邮件服务。

## 环境变量配置

### 基础配置

```bash
# 邮件服务提供商 (console|smtp|sendgrid|ses)
EMAIL_PROVIDER=console

# 发件人信息
EMAIL_FROM=noreply@arcadia-eternity.com
EMAIL_FROM_NAME=阿卡迪亚永恒
```

### 开发环境 (console)

开发环境下，邮件会输出到控制台，无需额外配置：

```bash
EMAIL_PROVIDER=console
```

### SMTP 配置

适用于大多数邮件服务商：

```bash
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
```

#### 常见SMTP配置

**Gmail:**
```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password  # 需要开启两步验证并生成应用密码
```

**Outlook/Hotmail:**
```bash
SMTP_HOST=smtp-mail.outlook.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@outlook.com
SMTP_PASS=your-password
```

**QQ邮箱:**
```bash
SMTP_HOST=smtp.qq.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@qq.com
SMTP_PASS=your-authorization-code  # 需要开启SMTP服务并获取授权码
```

**163邮箱:**
```bash
SMTP_HOST=smtp.163.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@163.com
SMTP_PASS=your-authorization-code
```

### SendGrid 配置

```bash
EMAIL_PROVIDER=sendgrid
SENDGRID_API_KEY=your-sendgrid-api-key
```

### AWS SES 配置

```bash
EMAIL_PROVIDER=ses
AWS_SES_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key
```

## 邮件模板

系统会自动发送格式化的验证码邮件，包含：

- HTML格式的精美邮件模板
- 纯文本版本（兼容性）
- 验证码高亮显示
- 安全提醒和有效期说明
- 品牌化设计

### 邮件内容示例

**主题：** 绑定邮箱验证码 - 阿卡迪亚永恒

**内容：**
```
您好！

您正在进行绑定邮箱操作。
玩家：训练师-abc1

您的验证码是：123456

验证码有效期为10分钟，请及时使用。
如果这不是您的操作，请忽略此邮件。

---
阿卡迪亚永恒团队
```

## 测试邮件服务

### 1. 验证连接

启动服务器时会自动验证邮件服务连接：

```bash
node dist/cli.js server --port 8103
```

成功时会看到：
```
Email service initialized with provider: smtp
Email service connection verified
```

### 2. 发送测试邮件

```bash
curl -X POST http://localhost:8103/api/v1/email/send-verification-code \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "playerId": "test123",
    "purpose": "bind"
  }'
```

### 3. 开发环境测试

开发环境下，邮件内容会输出到控制台：

```
📧 邮件发送 (开发模式):
收件人: test@example.com
主题: 绑定邮箱验证码 - 阿卡迪亚永恒
内容: 您好！您正在进行绑定邮箱操作...
```

## 故障排除

### 常见问题

1. **SMTP认证失败**
   - 检查用户名和密码是否正确
   - Gmail需要使用应用密码，不是账户密码
   - QQ/163邮箱需要开启SMTP服务并使用授权码

2. **连接超时**
   - 检查SMTP服务器地址和端口
   - 确认网络连接正常
   - 某些网络可能阻止SMTP连接

3. **邮件被拒绝**
   - 检查发件人邮箱是否已验证
   - 确认邮件内容不包含敏感词汇
   - 检查发送频率是否过高

4. **SendGrid/SES配置问题**
   - 确认API密钥有效
   - 检查发件人邮箱是否已在服务商处验证
   - 确认账户状态正常

### 调试技巧

1. **启用详细日志**：
   ```bash
   NODE_ENV=development node dist/cli.js server --port 8103
   ```

2. **测试SMTP连接**：
   ```bash
   # 使用telnet测试SMTP连接
   telnet smtp.gmail.com 587
   ```

3. **检查邮件服务状态**：
   - Gmail: https://www.google.com/appsstatus
   - SendGrid: https://status.sendgrid.com/
   - AWS SES: https://status.aws.amazon.com/

## 生产环境建议

### 安全性

1. **使用环境变量**：
   - 不要在代码中硬编码密码
   - 使用 `.env` 文件管理环境变量
   - 生产环境使用密钥管理服务

2. **限制发送频率**：
   - 系统已内置1分钟发送限制
   - 考虑添加每日发送限制
   - 监控异常发送行为

3. **邮件内容安全**：
   - 验证码仅包含数字
   - 不在邮件中包含敏感信息
   - 添加防钓鱼提醒

### 性能优化

1. **连接池**：
   - Nodemailer自动管理连接池
   - 避免频繁创建新连接

2. **异步发送**：
   - 邮件发送不阻塞API响应
   - 考虑使用队列处理大量邮件

3. **监控和日志**：
   - 记录邮件发送成功/失败
   - 监控发送延迟和成功率
   - 设置告警机制

## 示例配置文件

### .env.development
```bash
# 开发环境 - 控制台输出
EMAIL_PROVIDER=console
EMAIL_FROM=dev@arcadia-eternity.com
EMAIL_FROM_NAME=阿卡迪亚永恒(开发)
```

### .env.production
```bash
# 生产环境 - SendGrid
EMAIL_PROVIDER=sendgrid
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxxx
EMAIL_FROM=noreply@arcadia-eternity.com
EMAIL_FROM_NAME=阿卡迪亚永恒
```

### .env.staging
```bash
# 测试环境 - SMTP
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=staging@arcadia-eternity.com
SMTP_PASS=your-app-password
EMAIL_FROM=staging@arcadia-eternity.com
EMAIL_FROM_NAME=阿卡迪亚永恒(测试)
```
