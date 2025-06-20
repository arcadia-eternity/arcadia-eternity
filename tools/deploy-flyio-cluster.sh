#!/bin/bash

# Fly.io 集群部署脚本
# 用于在 Fly.io 上部署多实例集群服务

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查必要的工具
check_dependencies() {
    log_info "检查依赖工具..."
    
    if ! command -v fly &> /dev/null; then
        log_error "Fly CLI 未安装。请访问 https://fly.io/docs/getting-started/installing-flyctl/ 安装"
        exit 1
    fi
    
    if ! command -v docker &> /dev/null; then
        log_error "Docker 未安装。请安装 Docker"
        exit 1
    fi
    
    log_success "依赖检查完成"
}

# 检查 Fly.io 登录状态
check_fly_auth() {
    log_info "检查 Fly.io 认证状态..."
    
    if ! fly auth whoami &> /dev/null; then
        log_error "未登录 Fly.io。请运行 'fly auth login'"
        exit 1
    fi
    
    log_success "Fly.io 认证检查完成"
}

# 构建 Docker 镜像
build_image() {
    log_info "构建 Docker 镜像..."
    
    # 获取当前 Git 提交哈希作为标签
    local git_hash=$(git rev-parse --short HEAD 2>/dev/null || echo "latest")
    local image_tag="ghcr.io/arcadia-eternity/arcadia-eternity:${git_hash}"
    
    # 构建镜像
    docker build -t "$image_tag" .
    
    # 推送到 GitHub Container Registry
    log_info "推送镜像到 GitHub Container Registry..."
    docker push "$image_tag"
    
    echo "$image_tag"
}

# 设置 Fly.io 密钥
setup_secrets() {
    log_info "设置 Fly.io 密钥..."
    
    # 检查必要的环境变量
    if [[ -z "$REDIS_HOST" || -z "$REDIS_PASSWORD" ]]; then
        log_warning "Redis 配置未设置。请设置 REDIS_HOST 和 REDIS_PASSWORD 环境变量"
        log_info "或者手动运行: fly secrets set REDIS_HOST=your-redis-host REDIS_PASSWORD=your-redis-password"
    else
        fly secrets set REDIS_HOST="$REDIS_HOST" REDIS_PASSWORD="$REDIS_PASSWORD"
    fi
    
    # 设置 JWT 密钥（如果未设置）
    if [[ -z "$JWT_SECRET" ]]; then
        log_info "生成 JWT 密钥..."
        local jwt_secret=$(openssl rand -base64 32)
        fly secrets set JWT_SECRET="$jwt_secret"
    else
        fly secrets set JWT_SECRET="$JWT_SECRET"
    fi
    
    # 设置邮件配置（如果提供）
    if [[ -n "$SMTP_HOST" && -n "$SMTP_USER" && -n "$SMTP_PASS" ]]; then
        fly secrets set EMAIL_SMTP_HOST="$SMTP_HOST" EMAIL_SMTP_USER="$SMTP_USER" EMAIL_SMTP_PASS="$SMTP_PASS"
    fi
    
    # 设置 Supabase 配置（如果提供）
    if [[ -n "$SUPABASE_URL" && -n "$SUPABASE_ANON_KEY" ]]; then
        fly secrets set SUPABASE_URL="$SUPABASE_URL" SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY"
        
        if [[ -n "$SUPABASE_SERVICE_KEY" ]]; then
            fly secrets set SUPABASE_SERVICE_KEY="$SUPABASE_SERVICE_KEY"
        fi
    fi
    
    log_success "密钥设置完成"
}

# 部署应用
deploy_app() {
    local image_tag="$1"
    local scale_count="${2:-3}"  # 默认 3 个实例
    
    log_info "部署应用到 Fly.io..."
    
    # 更新 fly.toml 中的镜像
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        sed -i '' "s|# image = .*|image = \"$image_tag\"|" fly.toml
    else
        # Linux
        sed -i "s|# image = .*|image = \"$image_tag\"|" fly.toml
    fi
    
    # 部署应用
    fly deploy --image "$image_tag"
    
    # 扩展到指定数量的实例
    log_info "扩展到 $scale_count 个实例..."
    fly scale count "$scale_count"
    
    log_success "应用部署完成"
}

# 验证部署
verify_deployment() {
    log_info "验证部署状态..."
    
    # 检查应用状态
    fly status
    
    # 检查实例健康状态
    log_info "等待实例启动..."
    sleep 30
    
    # 检查健康端点
    local app_url=$(fly info --json | jq -r '.Hostname')
    if [[ -n "$app_url" ]]; then
        log_info "检查健康端点: https://$app_url/health"
        if curl -f "https://$app_url/health" &> /dev/null; then
            log_success "健康检查通过"
        else
            log_warning "健康检查失败，请检查应用日志"
        fi
    fi
    
    # 显示日志
    log_info "显示最近的应用日志..."
    fly logs --lines 50
}

# 主函数
main() {
    local scale_count="${1:-3}"
    
    log_info "开始 Fly.io 集群部署..."
    log_info "目标实例数量: $scale_count"
    
    # 检查依赖
    check_dependencies
    check_fly_auth
    
    # 构建和推送镜像
    local image_tag=$(build_image)
    log_success "镜像构建完成: $image_tag"
    
    # 设置密钥
    setup_secrets
    
    # 部署应用
    deploy_app "$image_tag" "$scale_count"
    
    # 验证部署
    verify_deployment
    
    log_success "Fly.io 集群部署完成！"
    log_info "应用 URL: https://$(fly info --json | jq -r '.Hostname')"
    log_info "监控面板: https://fly.io/apps/$(fly info --json | jq -r '.Name')"
}

# 显示帮助信息
show_help() {
    echo "Fly.io 集群部署脚本"
    echo ""
    echo "用法: $0 [实例数量]"
    echo ""
    echo "参数:"
    echo "  实例数量    要部署的实例数量 (默认: 3)"
    echo ""
    echo "环境变量:"
    echo "  REDIS_HOST           Redis 主机地址"
    echo "  REDIS_PASSWORD       Redis 密码"
    echo "  JWT_SECRET           JWT 密钥 (可选，会自动生成)"
    echo "  SMTP_HOST            SMTP 主机 (可选)"
    echo "  SMTP_USER            SMTP 用户名 (可选)"
    echo "  SMTP_PASS            SMTP 密码 (可选)"
    echo "  SUPABASE_URL         Supabase URL (可选)"
    echo "  SUPABASE_ANON_KEY    Supabase 匿名密钥 (可选)"
    echo "  SUPABASE_SERVICE_KEY Supabase 服务密钥 (可选)"
    echo ""
    echo "示例:"
    echo "  $0 5                 # 部署 5 个实例"
    echo "  REDIS_HOST=redis.example.com REDIS_PASSWORD=secret $0"
}

# 处理命令行参数
case "${1:-}" in
    -h|--help)
        show_help
        exit 0
        ;;
    *)
        main "$@"
        ;;
esac
