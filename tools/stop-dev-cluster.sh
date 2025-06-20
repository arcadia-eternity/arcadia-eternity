#!/bin/bash

# 开发集群停止脚本

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

# 停止集群
stop_cluster() {
    log_info "停止开发集群..."
    
    # 检查是否在项目根目录
    if [ ! -f "package.json" ]; then
        log_error "请在项目根目录运行此脚本"
        exit 1
    fi
    
    # 检查配置文件
    if [ ! -f "docker-compose.dev-cluster.yml" ]; then
        log_error "未找到docker-compose.dev-cluster.yml配置文件"
        exit 1
    fi
    
    # 停止所有服务
    docker-compose -f docker-compose.dev-cluster.yml down --remove-orphans
    
    if [ $? -eq 0 ]; then
        log_success "开发集群已停止"
    else
        log_error "停止集群时发生错误"
        exit 1
    fi
}

# 清理数据（可选）
cleanup_data() {
    if [ "$1" = "--clean-data" ]; then
        log_warning "清理持久化数据..."
        docker-compose -f docker-compose.dev-cluster.yml down -v
        log_success "数据清理完成"
    fi
}

# 显示帮助信息
show_help() {
    echo "用法: $0 [选项]"
    echo
    echo "选项:"
    echo "  --clean-data    同时清理持久化数据（Redis数据等）"
    echo "  --help         显示此帮助信息"
    echo
    echo "示例:"
    echo "  $0                # 仅停止集群"
    echo "  $0 --clean-data   # 停止集群并清理数据"
}

# 主函数
main() {
    case "$1" in
        --help)
            show_help
            exit 0
            ;;
        --clean-data)
            stop_cluster
            cleanup_data --clean-data
            ;;
        "")
            stop_cluster
            ;;
        *)
            log_error "未知选项: $1"
            show_help
            exit 1
            ;;
    esac
    
    log_success "操作完成！"
}

# 执行主函数
main "$@"
