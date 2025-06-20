#!/bin/bash

# Arcadia Eternity 集群部署脚本
# 用于在Fly.io上部署多实例集群

set -e

# 颜色定义
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
    log_info "检查部署依赖..."
    
    if ! command -v flyctl &> /dev/null; then
        log_error "flyctl 未安装。请访问 https://fly.io/docs/getting-started/installing-flyctl/ 安装"
        exit 1
    fi
    
    if ! command -v docker &> /dev/null; then
        log_error "Docker 未安装。请访问 https://docs.docker.com/get-docker/ 安装"
        exit 1
    fi
    
    log_success "依赖检查完成"
}

# 检查Fly.io认证
check_fly_auth() {
    log_info "检查Fly.io认证状态..."
    
    if ! flyctl auth whoami &> /dev/null; then
        log_error "未登录Fly.io。请运行 'flyctl auth login' 登录"
        exit 1
    fi
    
    log_success "Fly.io认证检查完成"
}

# 设置环境变量
setup_secrets() {
    log_info "设置Fly.io secrets..."
    
    # 检查必要的环境变量
    if [ -z "$REDIS_HOST" ]; then
        log_warning "REDIS_HOST 未设置，将使用默认值"
        REDIS_HOST="your-redis-host.com"
    fi
    
    if [ -z "$REDIS_PASSWORD" ]; then
        log_warning "REDIS_PASSWORD 未设置"
        read -s -p "请输入Redis密码: " REDIS_PASSWORD
        echo
    fi
    
    if [ -z "$SUPABASE_URL" ]; then
        log_warning "SUPABASE_URL 未设置"
        read -p "请输入Supabase URL (可选): " SUPABASE_URL
    fi
    
    if [ -z "$SUPABASE_ANON_KEY" ]; then
        log_warning "SUPABASE_ANON_KEY 未设置"
        read -p "请输入Supabase Anon Key (可选): " SUPABASE_ANON_KEY
    fi
    
    if [ -z "$SUPABASE_SERVICE_KEY" ]; then
        log_warning "SUPABASE_SERVICE_KEY 未设置"
        read -s -p "请输入Supabase Service Key (可选): " SUPABASE_SERVICE_KEY
        echo
    fi
    
    if [ -z "$EMAIL_SMTP_PASS" ]; then
        log_warning "EMAIL_SMTP_PASS 未设置"
        read -s -p "请输入SMTP密码 (可选): " EMAIL_SMTP_PASS
        echo
    fi
    
    # 设置secrets
    log_info "设置Redis配置..."
    flyctl secrets set REDIS_HOST="$REDIS_HOST" REDIS_PASSWORD="$REDIS_PASSWORD"
    
    if [ -n "$SUPABASE_URL" ] && [ -n "$SUPABASE_ANON_KEY" ]; then
        log_info "设置Supabase配置..."
        flyctl secrets set SUPABASE_URL="$SUPABASE_URL" SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY"
        
        if [ -n "$SUPABASE_SERVICE_KEY" ]; then
            flyctl secrets set SUPABASE_SERVICE_KEY="$SUPABASE_SERVICE_KEY"
        fi
    fi
    
    if [ -n "$EMAIL_SMTP_PASS" ]; then
        log_info "设置邮件配置..."
        flyctl secrets set EMAIL_SMTP_PASS="$EMAIL_SMTP_PASS"
    fi
    
    log_success "Secrets设置完成"
}

# 部署应用
deploy_app() {
    local scale_count=${1:-3}
    
    log_info "开始部署集群 (实例数: $scale_count)..."
    
    # 构建和部署
    log_info "构建和部署应用..."
    flyctl deploy --ha=false
    
    # 扩展到指定实例数
    log_info "扩展到 $scale_count 个实例..."
    flyctl scale count $scale_count
    
    log_success "应用部署完成"
}

# 检查部署状态
check_deployment() {
    log_info "检查部署状态..."
    
    # 等待实例启动
    sleep 30
    
    # 检查实例状态
    log_info "实例状态:"
    flyctl status
    
    # 检查健康状态
    log_info "检查健康状态..."
    APP_NAME=$(flyctl info --json | jq -r '.Name')
    HEALTH_URL="https://${APP_NAME}.fly.dev/health"
    
    if curl -f "$HEALTH_URL" &> /dev/null; then
        log_success "健康检查通过"
    else
        log_warning "健康检查失败，请检查日志"
    fi
    
    # 检查集群状态
    log_info "检查集群状态..."
    CLUSTER_URL="https://${APP_NAME}.fly.dev/cluster/status"
    
    if curl -f "$CLUSTER_URL" &> /dev/null; then
        log_success "集群状态检查通过"
        curl -s "$CLUSTER_URL" | jq '.'
    else
        log_warning "集群状态检查失败"
    fi
}

# 显示监控信息
show_monitoring_info() {
    log_info "监控信息:"
    
    APP_NAME=$(flyctl info --json | jq -r '.Name')
    
    echo "应用URL: https://${APP_NAME}.fly.dev"
    echo "健康检查: https://${APP_NAME}.fly.dev/health"
    echo "集群状态: https://${APP_NAME}.fly.dev/cluster/status"
    echo "Prometheus指标: https://${APP_NAME}.fly.dev/metrics"
    echo "API文档: https://${APP_NAME}.fly.dev/api-docs"
    
    log_info "查看日志: flyctl logs"
    log_info "查看实例: flyctl status"
    log_info "扩展实例: flyctl scale count <数量>"
}

# 主函数
main() {
    local scale_count=${1:-3}
    
    log_info "开始Arcadia Eternity集群部署..."
    
    check_dependencies
    check_fly_auth
    setup_secrets
    deploy_app "$scale_count"
    check_deployment
    show_monitoring_info
    
    log_success "集群部署完成！"
}

# 帮助信息
show_help() {
    echo "用法: $0 [实例数量]"
    echo ""
    echo "选项:"
    echo "  实例数量    要部署的实例数量 (默认: 3)"
    echo "  -h, --help  显示此帮助信息"
    echo ""
    echo "环境变量:"
    echo "  REDIS_HOST           Redis主机地址"
    echo "  REDIS_PASSWORD       Redis密码"
    echo "  SUPABASE_URL         Supabase URL (可选)"
    echo "  SUPABASE_ANON_KEY    Supabase匿名密钥 (可选)"
    echo "  SUPABASE_SERVICE_KEY Supabase服务密钥 (可选)"
    echo "  EMAIL_SMTP_PASS      SMTP密码 (可选)"
    echo ""
    echo "示例:"
    echo "  $0           # 部署3个实例"
    echo "  $0 5         # 部署5个实例"
}

# 参数处理
case "${1:-}" in
    -h|--help)
        show_help
        exit 0
        ;;
    "")
        main 3
        ;;
    *)
        if [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -gt 0 ] && [ "$1" -le 10 ]; then
            main "$1"
        else
            log_error "无效的实例数量: $1 (必须是1-10之间的数字)"
            show_help
            exit 1
        fi
        ;;
esac
