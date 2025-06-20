#!/bin/bash

# 开发集群启动脚本
# 使用现有编译好的代码启动集群，无需重新构建Docker镜像

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

# 检查必要的文件和目录
check_prerequisites() {
    log_info "检查前置条件..."
    
    # 检查是否在项目根目录
    if [ ! -f "package.json" ]; then
        log_error "请在项目根目录运行此脚本"
        exit 1
    fi
    
    # 检查编译产物
    if [ ! -f "dist/cli.js" ]; then
        log_warning "未找到编译产物，正在执行构建..."
        pnpm build
        if [ $? -ne 0 ]; then
            log_error "构建失败"
            exit 1
        fi
        log_success "构建完成"
    else
        log_success "找到编译产物"
    fi
    
    # 检查node_modules
    if [ ! -d "node_modules" ]; then
        log_warning "未找到node_modules，正在安装依赖..."
        pnpm install
        if [ $? -ne 0 ]; then
            log_error "依赖安装失败"
            exit 1
        fi
        log_success "依赖安装完成"
    else
        log_success "找到node_modules"
    fi
    
    # 检查Docker Compose配置文件
    if [ ! -f "docker-compose.dev-cluster.yml" ]; then
        log_error "未找到docker-compose.dev-cluster.yml配置文件"
        exit 1
    fi
    
    # 检查nginx配置文件
    if [ ! -f "nginx.cluster.conf" ]; then
        log_warning "未找到nginx.cluster.conf配置文件"
    fi
    
    log_success "前置条件检查完成"
}

# 清理旧容器
cleanup_old_containers() {
    log_info "清理旧的开发集群容器..."
    
    # 停止并删除旧容器
    docker-compose -f docker-compose.dev-cluster.yml down --remove-orphans 2>/dev/null || true
    
    log_success "旧容器清理完成"
}

# 启动集群
start_cluster() {
    log_info "启动开发集群..."
    
    # 启动基础服务（不包括监控）
    docker-compose -f docker-compose.dev-cluster.yml up -d redis app1 app2 app3 nginx
    
    if [ $? -ne 0 ]; then
        log_error "集群启动失败"
        exit 1
    fi
    
    log_success "开发集群启动成功"
}

# 等待服务就绪
wait_for_services() {
    log_info "等待服务就绪..."
    
    # 等待Redis就绪
    log_info "等待Redis服务..."
    timeout=30
    while [ $timeout -gt 0 ]; do
        if docker exec arcadia-redis-dev redis-cli ping >/dev/null 2>&1; then
            log_success "Redis服务就绪"
            break
        fi
        sleep 1
        timeout=$((timeout - 1))
    done
    
    if [ $timeout -eq 0 ]; then
        log_error "Redis服务启动超时"
        exit 1
    fi
    
    # 等待应用服务就绪
    for port in 8102 8103 8104; do
        log_info "等待应用服务 (端口 $port)..."
        timeout=60
        while [ $timeout -gt 0 ]; do
            if curl -f http://localhost:$port/health >/dev/null 2>&1; then
                log_success "应用服务 (端口 $port) 就绪"
                break
            fi
            sleep 2
            timeout=$((timeout - 2))
        done
        
        if [ $timeout -le 0 ]; then
            log_error "应用服务 (端口 $port) 启动超时"
            exit 1
        fi
    done
    
    # 等待Nginx就绪
    log_info "等待Nginx负载均衡器..."
    timeout=30
    while [ $timeout -gt 0 ]; do
        if curl -f http://localhost:8080/health >/dev/null 2>&1; then
            log_success "Nginx负载均衡器就绪"
            break
        fi
        sleep 1
        timeout=$((timeout - 1))
    done
    
    if [ $timeout -eq 0 ]; then
        log_error "Nginx负载均衡器启动超时"
        exit 1
    fi
}

# 显示服务信息
show_service_info() {
    log_success "开发集群启动完成！"
    echo
    echo "服务访问地址："
    echo "  负载均衡器: http://localhost:8080"
    echo "  应用实例1:  http://localhost:8102"
    echo "  应用实例2:  http://localhost:8103"
    echo "  应用实例3:  http://localhost:8104"
    echo "  Redis:      localhost:6379"
    echo
    echo "管理命令："
    echo "  查看日志:   docker-compose -f docker-compose.dev-cluster.yml logs -f"
    echo "  停止集群:   docker-compose -f docker-compose.dev-cluster.yml down"
    echo "  重启集群:   docker-compose -f docker-compose.dev-cluster.yml restart"
    echo
    echo "启动监控服务（可选）："
    echo "  docker-compose -f docker-compose.dev-cluster.yml --profile monitoring up -d"
    echo "  Prometheus: http://localhost:9090"
    echo "  Grafana:    http://localhost:3001 (admin/admin)"
    echo
}

# 主函数
main() {
    log_info "开始启动开发集群..."
    
    check_prerequisites
    cleanup_old_containers
    start_cluster
    wait_for_services
    show_service_info
    
    log_success "开发集群启动流程完成！"
}

# 处理中断信号
trap 'log_warning "收到中断信号，正在清理..."; docker-compose -f docker-compose.dev-cluster.yml down; exit 1' INT TERM

# 执行主函数
main "$@"
