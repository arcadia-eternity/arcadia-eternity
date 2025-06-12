# 构建和部署工具

本目录包含用于项目构建、部署和维护的工具脚本。

## 📁 目录结构

```
tools/
├── README.md                    # 本文件
├── setup-flyio-cicd.sh        # Fly.io CI/CD 设置脚本
└── manage-flyio-tokens.sh      # Fly.io 令牌管理脚本
```

## 🛠️ 工具说明

### setup-flyio-cicd.sh

**用途**: 自动化设置 Fly.io CI/CD 环境

**功能**:
- 检查 Fly CLI 安装和登录状态
- 验证 Fly.io 应用是否存在
- 创建 App-scoped Deploy Token
- 提供 GitHub Secrets 配置指导
- 显示可选的环境变量配置命令

**使用方法**:
```bash
./tools/setup-flyio-cicd.sh
```

**前置要求**:
- 已安装 Fly CLI
- 已登录 Fly.io 账户
- 已创建 Fly.io 应用 (或脚本会提示创建)

### manage-flyio-tokens.sh

**用途**: 交互式管理 Fly.io 访问令牌

**功能**:
- 查看应用和组织级别的令牌
- 创建新的部署令牌 (支持自定义名称和过期时间)
- 撤销现有令牌
- 令牌轮换 (创建新令牌并指导撤销旧令牌)

**使用方法**:
```bash
./tools/manage-flyio-tokens.sh
```

**支持的令牌类型**:
- App-scoped Deploy Token (推荐)
- Org-scoped Deploy Token

**支持的过期时间**:
- 30 天 (推荐用于生产环境)
- 90 天
- 1 年
- 自定义时间

## 🔒 安全最佳实践

1. **使用最小权限原则**: 优先使用 App-scoped token
2. **设置合理的过期时间**: 推荐 30-90 天
3. **定期轮换令牌**: 建议每 30-90 天轮换一次
4. **为令牌命名**: 使用描述性名称便于管理
5. **及时撤销不用的令牌**: 定期清理过期或不再使用的令牌

## 📚 相关文档

- [Fly.io CI/CD 配置指南](../docs/flyio-cicd-setup.md)
- [Fly.io 访问令牌文档](https://fly.io/docs/security/tokens/)

## 🆘 故障排除

### 常见问题

1. **权限被拒绝**
   ```bash
   chmod +x tools/*.sh
   ```

2. **Fly CLI 未找到**
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```

3. **未登录 Fly.io**
   ```bash
   flyctl auth login
   ```

4. **应用不存在**
   - 检查 `fly.toml` 中的应用名称
   - 或运行 `flyctl apps create <app-name>` 创建应用

## 🔄 维护

这些工具脚本会随着 Fly.io API 和最佳实践的更新而维护。如果遇到问题或有改进建议，请查看相关文档或提交 issue。
