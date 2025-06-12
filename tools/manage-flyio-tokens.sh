#!/bin/bash

# Fly.io 令牌管理脚本
# 此脚本帮助您管理 Fly.io 访问令牌

set -e

APP_NAME="test-battle"

echo "🔑 Fly.io 令牌管理工具"
echo "======================"

# 检查是否安装了 flyctl
if ! command -v flyctl &> /dev/null; then
    echo "❌ Fly CLI 未安装"
    echo "请先安装 Fly CLI: curl -L https://fly.io/install.sh | sh"
    exit 1
fi

# 检查是否已登录
if ! flyctl auth whoami &> /dev/null; then
    echo "🔐 请先登录 Fly.io"
    flyctl auth login
fi

echo "✅ 已登录 Fly.io"
echo "👤 当前用户: $(flyctl auth whoami)"
echo ""

# 主菜单
while true; do
    echo "请选择操作:"
    echo "1) 查看应用令牌"
    echo "2) 查看组织令牌"
    echo "3) 创建新的部署令牌"
    echo "4) 撤销令牌"
    echo "5) 令牌轮换 (创建新令牌并撤销旧令牌)"
    echo "6) 退出"
    echo ""
    read -p "请选择 (1-6): " -n 1 -r
    echo
    echo ""

    case $REPLY in
        1)
            echo "📋 应用 '$APP_NAME' 的令牌列表:"
            echo "================================"
            flyctl tokens list --app "$APP_NAME" || echo "❌ 无法获取令牌列表，请检查应用名称"
            echo ""
            ;;
        2)
            echo "📋 组织级别的令牌列表:"
            echo "===================="
            flyctl tokens list --scope org || echo "❌ 无法获取组织令牌列表"
            echo ""
            ;;
        3)
            echo "🔑 创建新的部署令牌"
            echo "=================="
            
            # 询问令牌类型
            echo "请选择令牌类型:"
            echo "1) App-scoped Deploy Token (推荐)"
            echo "2) Org-scoped Deploy Token"
            read -p "请选择 (1-2): " -n 1 -r
            echo
            
            # 询问过期时间
            echo "请选择过期时间:"
            echo "1) 30 天 (推荐)"
            echo "2) 90 天"
            echo "3) 1 年"
            echo "4) 自定义"
            read -p "请选择 (1-4): " -n 1 -r
            echo
            
            case $REPLY in
                1) EXPIRY="720h"; EXPIRY_DESC="30天" ;;
                2) EXPIRY="2160h"; EXPIRY_DESC="90天" ;;
                3) EXPIRY="8760h"; EXPIRY_DESC="1年" ;;
                4) 
                    read -p "请输入过期时间 (例如: 24h, 7d, 30d): " EXPIRY
                    EXPIRY_DESC="$EXPIRY"
                    ;;
                *) EXPIRY="720h"; EXPIRY_DESC="30天"; echo "使用默认值: 30天" ;;
            esac
            
            # 询问令牌名称
            read -p "请输入令牌名称 (默认: GitHub Actions CI/CD): " TOKEN_NAME
            TOKEN_NAME=${TOKEN_NAME:-"GitHub Actions CI/CD"}
            
            echo ""
            echo "正在创建令牌..."
            echo "名称: $TOKEN_NAME"
            echo "过期时间: $EXPIRY_DESC"
            echo "----------------------------------------"
            
            if [[ $REPLY == 1 ]]; then
                flyctl tokens create deploy --name "$TOKEN_NAME" --expiry "$EXPIRY" --app "$APP_NAME"
            else
                flyctl tokens create org --name "$TOKEN_NAME" --expiry "$EXPIRY"
            fi
            
            echo "----------------------------------------"
            echo "✅ 令牌创建成功！请将上面的令牌保存到 GitHub Secrets 中"
            echo ""
            ;;
        4)
            echo "🗑️  撤销令牌"
            echo "==========="
            
            echo "当前令牌列表:"
            flyctl tokens list --app "$APP_NAME" 2>/dev/null || true
            flyctl tokens list --scope org 2>/dev/null || true
            echo ""
            
            read -p "请输入要撤销的令牌 ID: " TOKEN_ID
            if [[ -n "$TOKEN_ID" ]]; then
                echo "正在撤销令牌 $TOKEN_ID..."
                flyctl tokens revoke "$TOKEN_ID"
                echo "✅ 令牌已撤销"
            else
                echo "❌ 令牌 ID 不能为空"
            fi
            echo ""
            ;;
        5)
            echo "🔄 令牌轮换"
            echo "=========="
            echo "此操作将创建新令牌并帮助您撤销旧令牌"
            echo ""
            
            # 显示当前令牌
            echo "当前令牌列表:"
            flyctl tokens list --app "$APP_NAME" 2>/dev/null || true
            echo ""
            
            read -p "是否继续创建新令牌? (y/N): " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                # 创建新令牌 (复用创建令牌的逻辑)
                EXPIRY="720h"
                TOKEN_NAME="GitHub Actions CI/CD ($(date +%Y%m%d))"
                
                echo "正在创建新令牌: $TOKEN_NAME"
                echo "----------------------------------------"
                flyctl tokens create deploy --name "$TOKEN_NAME" --expiry "$EXPIRY" --app "$APP_NAME"
                echo "----------------------------------------"
                echo ""
                echo "✅ 新令牌创建成功！"
                echo "📋 下一步操作:"
                echo "1. 将新令牌更新到 GitHub Secrets"
                echo "2. 测试部署是否正常"
                echo "3. 回到此脚本撤销旧令牌"
                echo ""
            fi
            ;;
        6)
            echo "👋 再见！"
            exit 0
            ;;
        *)
            echo "❌ 无效选择，请重试"
            echo ""
            ;;
    esac
done
