#!/bin/bash

# Fly.io CI/CD 设置脚本
# 此脚本帮助您快速配置 Fly.io CI/CD 环境

set -e

echo "🚀 Fly.io CI/CD 设置脚本"
echo "========================"

# 检查是否安装了 flyctl
if ! command -v flyctl &> /dev/null; then
    echo "❌ Fly CLI 未安装"
    echo "请先安装 Fly CLI: curl -L https://fly.io/install.sh | sh"
    exit 1
fi

echo "✅ Fly CLI 已安装"

# 检查是否已登录
if ! flyctl auth whoami &> /dev/null; then
    echo "🔐 请先登录 Fly.io"
    flyctl auth login
fi

echo "✅ 已登录 Fly.io"

# 获取当前用户信息
USER_EMAIL=$(flyctl auth whoami)
echo "👤 当前用户: $USER_EMAIL"

# 检查应用是否存在
APP_NAME="test-battle"
if flyctl apps list | grep -q "$APP_NAME"; then
    echo "✅ 应用 '$APP_NAME' 已存在"
else
    echo "❌ 应用 '$APP_NAME' 不存在"
    read -p "是否创建应用 '$APP_NAME'? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        flyctl apps create "$APP_NAME"
        echo "✅ 应用 '$APP_NAME' 创建成功"
    else
        echo "请手动创建应用或修改 fly.toml 中的应用名称"
        exit 1
    fi
fi

# 生成 API Token
echo ""
echo "🔑 生成 App-scoped Deploy Token"
echo "为了安全起见，我们将创建一个仅限于此应用的部署令牌"
echo ""

# 询问令牌过期时间
echo "请选择令牌过期时间:"
echo "1) 30 天 (推荐用于生产环境)"
echo "2) 90 天"
echo "3) 1 年"
echo "4) 自定义"
read -p "请选择 (1-4): " -n 1 -r
echo

case $REPLY in
    1)
        EXPIRY="720h"  # 30 days
        EXPIRY_DESC="30天"
        ;;
    2)
        EXPIRY="2160h"  # 90 days
        EXPIRY_DESC="90天"
        ;;
    3)
        EXPIRY="8760h"  # 1 year
        EXPIRY_DESC="1年"
        ;;
    4)
        read -p "请输入过期时间 (例如: 24h, 7d, 30d): " EXPIRY
        EXPIRY_DESC="$EXPIRY"
        ;;
    *)
        EXPIRY="720h"  # default to 30 days
        EXPIRY_DESC="30天"
        echo "使用默认值: 30天"
        ;;
esac

echo ""
echo "正在创建 App-scoped Deploy Token (过期时间: $EXPIRY_DESC)..."
echo "请将以下 Token 添加到 GitHub Secrets 中，名称为 'FLY_API_TOKEN':"
echo "----------------------------------------"
flyctl tokens create deploy --name "GitHub Actions CI/CD" --expiry "$EXPIRY" --app "$APP_NAME"
echo "----------------------------------------"

echo ""
echo "📋 GitHub Secrets 配置步骤:"
echo "1. 访问 GitHub 仓库设置页面"
echo "2. 点击 'Secrets and variables' -> 'Actions'"
echo "3. 点击 'New repository secret'"
echo "4. 名称: FLY_API_TOKEN"
echo "5. 值: 上面显示的 Token"

echo ""
echo "🔧 可选环境变量配置:"
echo "如果需要配置环境变量，请运行以下命令:"
echo ""
echo "# 基础配置"
echo "flyctl secrets set CORS_ORIGIN=\"https://battle.yuuinih.com\""
echo "# ARCADIA_DATA_DIR 必须指向持久卷；单个工作区只运行一个 owner。"
echo "# SQLite 默认无需外部数据库。使用 PostgreSQL 时配置标准连接串："
echo "flyctl secrets set STORAGE_DRIVER=postgres"
echo "flyctl secrets set DATABASE_URL=\"postgres://user:password@host:5432/arcadia\""
echo ""
echo "# 可选 G3 玩家账号，需要真实 SMTP 和 GitHub App 两条路径："
echo "flyctl secrets set ACCOUNT_MODE=g3 SMTP_HOST=\"smtp.example.com\" SMTP_FROM=\"Arcadia <no-reply@example.com>\""
echo "flyctl secrets set SMTP_USER=\"smtp-user\" SMTP_PASSWORD=\"smtp-password\""
echo "flyctl secrets set GITHUB_APP_CLIENT_ID=\"client-id\" GITHUB_APP_CLIENT_SECRET=\"client-secret\""
echo "flyctl secrets set GITHUB_APP_REDIRECT_URIS=\"https://battle.yuuinih.com/account\""
echo "# Guest 玩家模式也可通过 server admin login-code 初始化管理登录。"
echo "# 尚未启动过服务时，先执行 server db migrate 初始化数据目录。"
echo "# Fly 负责公网 HTTPS。跨站管理网页可设置 MANAGEMENT_COOKIE_SAME_SITE=none。"
echo "# 内容来源通过 ARCADIA_CONTENT_SOURCES 注册；允许取得内容与允许执行代码分别配置。"
echo "# 数据库迁移和管理命令见 docs/guides/unified-management.md。"

echo ""
echo "✅ 设置完成!"
echo "现在您可以推送代码到 main 分支来触发自动部署"
echo ""
echo "📚 当前运行与部署说明: docs/guides/server-runtime.md"
