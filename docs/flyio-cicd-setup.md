# Fly.io CI/CD 配置指南

本文档介绍如何为项目配置 Fly.io 的持续集成和部署 (CI/CD)。

## 概述

我们的 CI/CD 流程包含两个主要步骤：

1. **构建 Docker 镜像** (`.github/workflows/build-docker.yaml`)
   - 当代码推送到 `main` 或 `master` 分支时触发
   - 构建 Docker 镜像并推送到 GitHub Container Registry
   - 为后续部署提供镜像信息

2. **部署到 Fly.io** (`.github/workflows/deploy-flyio.yaml`)
   - 依赖于 Docker 构建工作流的成功完成
   - 自动部署最新的 Docker 镜像到 Fly.io
   - 包含部署验证和健康检查

## 前置要求

### 1. Fly.io 账户和应用

确保您已经：

- 注册了 [Fly.io](https://fly.io) 账户
- 安装了 Fly CLI: `curl -L https://fly.io/install.sh | sh`
- 创建了应用: `flyctl apps create test-battle`

### 2. GitHub Secrets 配置

在 GitHub 仓库设置中添加以下 Secrets：

#### 必需的 Secrets

- `FLY_API_TOKEN`: Fly.io App-scoped Deploy Token (推荐)

  ```bash
  # 创建 App-scoped 部署令牌 (仅限于特定应用)
  flyctl tokens create deploy --name "GitHub Actions CI/CD" --expiry 720h --app test-battle

  # 或者创建 Org-scoped 令牌 (如果需要管理多个应用)
  flyctl tokens create org --name "GitHub Actions CI/CD" --expiry 720h
  ```

  **安全建议**:
  - 使用 App-scoped token 限制访问范围到单个应用
  - 设置合理的过期时间 (推荐 30-90 天)
  - 为令牌设置描述性名称便于管理

#### 可选的 Secrets (如果需要数据库功能)

- `SUPABASE_URL`: Supabase 项目 URL
- `SUPABASE_ANON_KEY`: Supabase 匿名密钥  
- `SUPABASE_SERVICE_KEY`: Supabase 服务密钥

## 配置步骤

### 1. 设置 Fly.io API 令牌

```bash
# 登录 Fly.io
flyctl auth login

# 创建 App-scoped 部署令牌 (推荐 - 仅限于特定应用)
flyctl tokens create deploy --name "GitHub Actions CI/CD" --expiry 720h --app test-battle

# 或者，如果需要管理多个应用，创建 Org-scoped 令牌
flyctl tokens create org --name "GitHub Actions CI/CD" --expiry 720h
```

将获得的令牌添加到 GitHub Secrets 中，名称为 `FLY_API_TOKEN`。

**令牌类型说明**:

- **App-scoped token**: 仅能访问指定的单个应用，安全性最高，推荐用于单应用部署
- **Org-scoped token**: 可以访问组织内的所有应用，适用于多应用管理
- **过期时间**: 建议设置 30-90 天的过期时间，定期轮换令牌

### 2. 配置 fly.toml

确保 `fly.toml` 文件配置正确：

```toml
app = 'test-battle'
primary_region = 'hkg'

[build]
image = 'ghcr.io/arcadia-eternity/arcadia-eternity:main'

[http_service]
internal_port = 8102
force_https = true
auto_stop_machines = 'stop'
auto_start_machines = true
min_machines_running = 0

[[vm]]
memory = '1gb'
cpu_kind = 'shared'
cpus = 1
```

### 3. 设置环境变量 (可选)

如果需要在 Fly.io 上设置环境变量：

```bash
# 设置基础环境变量
flyctl secrets set EMAIL_PROVIDER=ses
flyctl secrets set AWS_SES_REGION=ap-southeast-1
flyctl secrets set EMAIL_FROM=noreply@yuuinih.com
flyctl secrets set EMAIL_FROM_NAME="阿卡迪亚永恒"
flyctl secrets set CORS_ORIGIN="https://battle.yuuinih.com,https://test-battle.netlify.app"

# 如果需要数据库功能，设置 Supabase 配置
flyctl secrets set SUPABASE_URL="your-supabase-url"
flyctl secrets set SUPABASE_ANON_KEY="your-anon-key"
flyctl secrets set SUPABASE_SERVICE_KEY="your-service-key"
```

## 工作流程

### 自动部署流程

1. **代码推送**: 推送代码到 `main` 或 `master` 分支
2. **Docker 构建**: GitHub Actions 自动构建并推送 Docker 镜像
3. **自动部署**: Docker 构建成功后，自动触发 Fly.io 部署
4. **健康检查**: 部署完成后进行健康检查验证

### 手动部署

您也可以手动触发部署：

1. 在 GitHub 仓库的 Actions 页面
2. 选择 "Deploy to Fly.io" 工作流
3. 点击 "Run workflow" 按钮

## 监控和故障排除

### 查看部署状态

```bash
# 查看应用状态
flyctl status

# 查看应用日志
flyctl logs

# 查看部署历史
flyctl releases
```

### 常见问题

1. **部署超时**
   - 检查 Docker 镜像是否正确构建
   - 确认 `fly.toml` 配置正确
   - 查看 Fly.io 日志了解详细错误

2. **健康检查失败**
   - 确认应用在端口 8102 上正确启动
   - 检查 `/health` 端点是否可访问
   - 查看应用日志了解启动问题

3. **权限错误**
   - 确认 `FLY_API_TOKEN` 正确设置
   - 检查令牌是否有足够的权限

## 令牌管理

### 使用令牌管理脚本 (推荐)

我们提供了一个交互式脚本来简化令牌管理：

```bash
# 运行令牌管理脚本
./tools/manage-flyio-tokens.sh
```

该脚本提供以下功能：

- 查看应用和组织级别的令牌
- 创建新的部署令牌 (支持自定义名称和过期时间)
- 撤销现有令牌
- 令牌轮换 (创建新令牌并指导撤销旧令牌)

### 手动令牌管理

如果您更喜欢手动管理令牌：

#### 查看现有令牌

```bash
# 查看当前应用的所有令牌
flyctl tokens list --app test-battle

# 查看组织级别的所有令牌
flyctl tokens list --scope org
```

#### 撤销令牌

```bash
# 列出令牌并复制要撤销的令牌 ID
flyctl tokens list --app test-battle

# 撤销指定令牌
flyctl tokens revoke <token-id>
```

#### 令牌轮换

建议定期轮换令牌以提高安全性：

1. 创建新令牌
2. 更新 GitHub Secrets
3. 测试部署是否正常
4. 撤销旧令牌

## 安全注意事项

- **使用最小权限原则**: 优先使用 App-scoped token 而不是 Org-scoped token
- **设置合理的过期时间**: 推荐 30-90 天，避免使用永不过期的令牌
- **永远不要在代码中硬编码敏感信息**: 始终使用 GitHub Secrets
- **定期轮换 API 令牌**: 建议每 30-90 天轮换一次
- **监控令牌使用**: 定期检查令牌列表，撤销不再使用的令牌
- **为令牌命名**: 使用描述性名称便于识别和管理

## 相关链接

- [Fly.io 文档](https://fly.io/docs/)
- [Fly.io 访问令牌文档](https://fly.io/docs/security/tokens/)
- [GitHub Actions 文档](https://docs.github.com/en/actions)
- [Docker 构建工作流](.github/workflows/build-docker.yaml)
- [Fly.io 部署工作流](.github/workflows/deploy-flyio.yaml)
- [确保最新镜像部署指南](ensure-latest-image-deployment.md)
- [CI/CD 设置脚本](../tools/setup-flyio-cicd.sh)
- [令牌管理脚本](../tools/manage-flyio-tokens.sh)
