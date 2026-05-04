# 版本管理系统配置指南

## 🚀 系统概述

我们实现了一个基于双分支的版本管理系统，确保生产环境中客户端、Web和服务器版本完全统一。

## 📋 分支策略

### main 分支 (开发环境)

- **用途**: 日常开发和测试
- **自动部署**:
  - Docker镜像构建 (标签: `dev`, `main-{sha}`)
  - 开发环境可用于测试

### production 分支 (生产环境)

- **用途**: 生产环境部署
- **触发方式**: 当创建release时自动从main合并
- **部署目标**:
  - Cloudflare Pages 生产站点
  - Fly.io 生产服务器
  - Tauri 桌面应用

## 🔧 GitHub 仓库设置

### 必需的权限配置

1. **Settings → Actions → General**:
   - Workflow permissions: `Read and write permissions`
   - ✅ Allow GitHub Actions to create and approve pull requests

2. **Settings → Branches**:
   - 保护 `production` 分支 (可选)
   - 要求PR审核 (推荐)

### 环境配置

1. **开发环境** (`development`):
   - 无需特殊配置
   - 自动部署到开发服务器

2. **生产环境** (`production`):
   - 需要审核 (推荐)
   - 配置生产环境密钥

## 📦 Cloudflare Pages 配置

### 开发站点

```
项目名称: arcadia-eternity-dev
分支: main
构建命令: pnpm build
输出目录: packages/web-ui/dist
域名: dev.yourdomain.com
```

### 生产站点

```
项目名称: arcadia-eternity-prod
分支: production
构建命令: pnpm build
输出目录: packages/web-ui/dist
域名: yourdomain.com
```

## 🚀 发布流程

### 1. 日常开发

```bash
# 使用 Conventional Commits
git commit -m "feat: add new battle system"
git commit -m "fix: resolve pet animation issue"
git commit -m "docs: update API documentation"

# 推送到main分支
git push origin main
```

### 2. 自动版本管理

- release-please 监控 main 分支的提交
- 根据 Conventional Commits 自动判断版本类型:
  - `feat:` → minor 版本 (0.1.0 → 0.2.0)
  - `fix:` → patch 版本 (0.1.0 → 0.1.1)
  - `feat!:` 或 `BREAKING CHANGE:` → major 版本 (0.1.0 → 1.0.0)

### 3. 创建发布

- release-please 自动创建 Release PR
- PR 包含:
  - 更新的版本号
  - 自动生成的 CHANGELOG
  - 更新的 package.json 和 tauri.conf.json

### 4. 发布到生产环境

```bash
# 审核并合并 Release PR
# 这将触发:
# 1. 创建 GitHub Release
# 2. 合并 main 到 production 分支
# 3. 构建生产环境 Docker 镜像
# 4. 部署到 Fly.io 生产环境
# 5. 构建 Tauri 桌面应用
```

## 🔍 版本信息显示

### 前端应用

- **桌面端**: 左下角显示版本信息
- **移动端**: 侧边菜单底部显示版本信息
- **点击版本号**: 查看详细信息和检查更新 (Tauri)

### 版本格式

- **生产环境**: `v1.2.3`
- **开发环境**: `v1.2.3-dev.a1b2c3d`

## 🛠️ 故障排除

### release-please 权限错误

如果遇到 "GitHub Actions is not permitted to create or approve pull requests" 错误:

1. 检查仓库设置:
   - Settings → Actions → General
   - 确保选择了 "Read and write permissions"
   - 确保勾选了 "Allow GitHub Actions to create and approve pull requests"

2. 手动触发 workflow:
   ```bash
   # 在 GitHub Actions 页面手动运行 "Release Please" workflow
   ```

### 版本号不更新

1. 确保使用 Conventional Commits 格式
2. 检查 `.release-please-manifest.json` 中的版本号
3. 确保提交包含实际的代码更改

### Docker 构建失败

1. 检查 Dockerfile 中的环境变量
2. 确保所有依赖都正确安装
3. 检查构建日志中的具体错误信息

## 📚 相关文档

- [Conventional Commits](https://www.conventionalcommits.org/)
- [release-please](https://github.com/googleapis/release-please)
- [GitHub Actions Permissions](https://docs.github.com/en/actions/security-guides/automatic-token-authentication#permissions-for-the-github_token)
