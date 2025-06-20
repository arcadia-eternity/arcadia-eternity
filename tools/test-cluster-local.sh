#!/bin/bash

# Arcadia Eternity 本地集群测试脚本
# 用于在本地Docker环境中测试集群功能

set -e

# 加载环境变量
load_env() {
    if [ -f .env ]; then
        log_info "加载 .env 文件..."
        export $(grep -v '^#' .env | xargs)
    elif [ -f .env.example ]; then
        log_warning "未找到 .env 文件，建议复制 .env.example 为 .env 并配置"
    fi
}

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

# 检查Docker
check_docker() {
    log_info "检查Docker环境..."
    
    if ! command -v docker &> /dev/null; then
        log_error "Docker 未安装。请访问 https://docs.docker.com/get-docker/ 安装"
        exit 1
    fi
    
    if ! command -v docker-compose &> /dev/null; then
        log_error "Docker Compose 未安装。请安装Docker Compose"
        exit 1
    fi
    
    if ! docker info &> /dev/null; then
        log_error "Docker 未运行。请启动Docker"
        exit 1
    fi
    
    log_success "Docker环境检查完成"
}

# 构建镜像
build_images() {
    log_info "构建应用镜像..."
    
    # 构建应用镜像
    docker build -t arcadia-eternity:latest .
    
    log_success "镜像构建完成"
}

# 启动集群
start_cluster() {
    local with_monitoring=${1:-false}
    
    log_info "启动集群..."
    
    # 停止现有容器
    docker-compose -f docker-compose.cluster.yml down
    
    # 启动基础服务
    if [ "$with_monitoring" = "true" ]; then
        log_info "启动集群（包含监控）..."
        docker-compose -f docker-compose.cluster.yml --profile monitoring up -d
    else
        log_info "启动集群（基础服务）..."
        docker-compose -f docker-compose.cluster.yml up -d
    fi
    
    log_success "集群启动完成"
}

# 等待服务就绪
wait_for_services() {
    log_info "等待服务就绪..."
    
    # 等待Redis
    log_info "等待Redis..."
    while ! docker-compose -f docker-compose.cluster.yml exec redis redis-cli ping &> /dev/null; do
        sleep 2
    done
    log_success "Redis就绪"
    
    # 等待应用实例
    for app in app1 app2 app3; do
        log_info "等待 $app..."
        local port
        case $app in
            app1) port=8102 ;;
            app2) port=8103 ;;
            app3) port=8104 ;;
        esac
        
        while ! curl -f "http://localhost:$port/health" &> /dev/null; do
            sleep 5
        done
        log_success "$app 就绪"
    done
    
    # 等待Nginx
    log_info "等待Nginx..."
    while ! curl -f "http://localhost/health" &> /dev/null; do
        sleep 2
    done
    log_success "Nginx就绪"
}

# 测试集群功能
test_cluster() {
    log_info "测试集群功能..."
    
    # 测试健康检查
    log_info "测试健康检查..."
    for port in 8102 8103 8104; do
        if curl -f "http://localhost:$port/health" &> /dev/null; then
            log_success "实例 localhost:$port 健康检查通过"
        else
            log_error "实例 localhost:$port 健康检查失败"
        fi
    done
    
    # 测试负载均衡
    log_info "测试负载均衡..."
    if curl -f "http://localhost/health" &> /dev/null; then
        log_success "负载均衡健康检查通过"
    else
        log_error "负载均衡健康检查失败"
    fi
    
    # 测试集群状态
    log_info "测试集群状态..."
    for port in 8102 8103 8104; do
        local response=$(curl -s "http://localhost:$port/cluster/status")
        if echo "$response" | jq -e '.enabled == true' &> /dev/null; then
            local instance_id=$(echo "$response" | jq -r '.instanceId')
            log_success "实例 $instance_id 集群状态正常"
        else
            log_error "实例 localhost:$port 集群状态异常"
        fi
    done
    
    # 测试Prometheus指标
    log_info "测试Prometheus指标..."
    for port in 8102 8103 8104; do
        if curl -f "http://localhost:$port/metrics" &> /dev/null; then
            log_success "实例 localhost:$port Prometheus指标可用"
        else
            log_warning "实例 localhost:$port Prometheus指标不可用"
        fi
    done
}

# 显示集群信息
show_cluster_info() {
    log_info "集群信息:"
    
    echo "负载均衡器: http://localhost"
    echo "应用实例:"
    echo "  - app1: http://localhost:8102"
    echo "  - app2: http://localhost:8103"
    echo "  - app3: http://localhost:8104"
    echo ""
    echo "监控端点:"
    echo "  - 健康检查: http://localhost/health"
    echo "  - 集群状态: http://localhost/cluster/status"
    echo "  - Prometheus指标: http://localhost/metrics"
    echo "  - API文档: http://localhost/api-docs"
    echo ""
    echo "Redis: localhost:6379"
    echo ""
    
    # 如果启用了监控
    if docker-compose -f docker-compose.cluster.yml ps prometheus &> /dev/null; then
        echo "监控服务:"
        echo "  - Prometheus: http://localhost:9090"
        echo "  - Grafana: http://localhost:3001 (admin/admin)"
        echo ""
    fi
    
    echo "管理命令:"
    echo "  - 查看日志: docker-compose -f docker-compose.cluster.yml logs -f"
    echo "  - 查看状态: docker-compose -f docker-compose.cluster.yml ps"
    echo "  - 停止集群: docker-compose -f docker-compose.cluster.yml down"
    echo "  - 重启服务: docker-compose -f docker-compose.cluster.yml restart <service>"
}

# 停止集群
stop_cluster() {
    log_info "停止集群..."
    
    docker-compose -f docker-compose.cluster.yml down
    
    log_success "集群已停止"
}

# 清理资源
cleanup() {
    log_info "清理资源..."
    
    # 停止并删除容器
    docker-compose -f docker-compose.cluster.yml down -v
    
    # 删除镜像（可选）
    if [ "${CLEANUP_IMAGES:-false}" = "true" ]; then
        log_info "删除镜像..."
        docker rmi arcadia-eternity:latest || true
    fi
    
    log_success "清理完成"
}

# 查看日志
show_logs() {
    local service=${1:-}
    
    if [ -n "$service" ]; then
        log_info "显示 $service 日志..."
        docker-compose -f docker-compose.cluster.yml logs -f "$service"
    else
        log_info "显示所有服务日志..."
        docker-compose -f docker-compose.cluster.yml logs -f
    fi
}

# 主函数
main() {
    local action=${1:-start}
    local with_monitoring=${2:-false}
    
    case "$action" in
        start)
            check_docker
            build_images
            start_cluster "$with_monitoring"
            wait_for_services
            test_cluster
            show_cluster_info
            ;;
        stop)
            stop_cluster
            ;;
        restart)
            stop_cluster
            main start "$with_monitoring"
            ;;
        test)
            test_cluster
            ;;
        logs)
            show_logs "$with_monitoring"
            ;;
        cleanup)
            cleanup
            ;;
        info)
            show_cluster_info
            ;;
        *)
            show_help
            exit 1
            ;;
    esac
}

# 帮助信息
show_help() {
    echo "用法: $0 <action> [options]"
    echo ""
    echo "Actions:"
    echo "  start [monitoring]  启动集群 (可选: 启用监控)"
    echo "  stop               停止集群"
    echo "  restart [monitoring] 重启集群"
    echo "  test               测试集群功能"
    echo "  logs [service]     查看日志"
    echo "  cleanup            清理所有资源"
    echo "  info               显示集群信息"
    echo "  -h, --help         显示此帮助信息"
    echo ""
    echo "示例:"
    echo "  $0 start           # 启动基础集群"
    echo "  $0 start monitoring # 启动集群并包含监控"
    echo "  $0 logs app1       # 查看app1日志"
    echo "  $0 test            # 测试集群功能"
    echo "  $0 stop            # 停止集群"
}

# 参数处理
case "${1:-}" in
    -h|--help)
        show_help
        exit 0
        ;;
    "")
        main start
        ;;
    *)
        main "$@"
        ;;
esac
