#!/bin/bash

# 集群端口测试脚本
# 用于验证集群服务的端口配置是否正确

set -e

echo "🔍 测试集群端口配置..."

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 测试函数
test_port() {
    local host=$1
    local port=$2
    local service=$3
    local path=${4:-"/health"}
    
    echo -n "测试 $service ($host:$port$path)... "
    
    if curl -s -f --connect-timeout 5 "http://$host:$port$path" > /dev/null 2>&1; then
        echo -e "${GREEN}✅ 成功${NC}"
        return 0
    else
        echo -e "${RED}❌ 失败${NC}"
        return 1
    fi
}

# 测试端口是否被占用
check_port_usage() {
    local port=$1
    local service=$2
    
    echo -n "检查端口 $port ($service)... "
    
    if lsof -i :$port > /dev/null 2>&1; then
        echo -e "${YELLOW}⚠️  端口被占用${NC}"
        echo "占用进程:"
        lsof -i :$port
        return 1
    else
        echo -e "${GREEN}✅ 端口可用${NC}"
        return 0
    fi
}

echo "📋 检查端口占用情况..."
check_port_usage 80 "HTTP (可能冲突)"
check_port_usage 8080 "Nginx负载均衡器"
check_port_usage 8102 "App1直连"
check_port_usage 8103 "App2直连"
check_port_usage 8104 "App3直连"
check_port_usage 6379 "Redis"
check_port_usage 9090 "Prometheus"

echo ""
echo "🐳 检查Docker容器状态..."
if docker-compose -f docker-compose.cluster.yml ps | grep -q "Up"; then
    echo -e "${GREEN}✅ 集群容器正在运行${NC}"
    docker-compose -f docker-compose.cluster.yml ps
else
    echo -e "${RED}❌ 集群容器未运行${NC}"
    echo "请先启动集群: docker-compose -f docker-compose.cluster.yml up -d"
    exit 1
fi

echo ""
echo "🌐 测试服务端点..."

# 测试各个应用实例
test_port "localhost" "8102" "App1直连"
test_port "localhost" "8103" "App2直连" 
test_port "localhost" "8104" "App3直连"

# 测试Nginx负载均衡器
test_port "localhost" "8080" "Nginx负载均衡器"
test_port "localhost" "8080" "Nginx API" "/api/v1/health"
test_port "localhost" "8080" "Nginx集群状态" "/cluster/status"

# 测试Redis
echo -n "测试 Redis (localhost:6379)... "
if redis-cli -h localhost -p 6379 ping > /dev/null 2>&1; then
    echo -e "${GREEN}✅ 成功${NC}"
else
    echo -e "${RED}❌ 失败${NC}"
fi

# 测试WebSocket连接
echo -n "测试 WebSocket (localhost:8080/socket.io/)... "
if curl -s --connect-timeout 5 "http://localhost:8080/socket.io/" | grep -q "socket.io"; then
    echo -e "${GREEN}✅ 成功${NC}"
else
    echo -e "${RED}❌ 失败${NC}"
fi

echo ""
echo "📊 集群状态检查..."
if curl -s "http://localhost:8080/cluster/status" | jq . > /dev/null 2>&1; then
    echo -e "${GREEN}✅ 集群状态API正常${NC}"
    echo "集群状态:"
    curl -s "http://localhost:8080/cluster/status" | jq .
else
    echo -e "${YELLOW}⚠️  集群状态API无响应或格式错误${NC}"
fi

echo ""
echo "🎯 推荐的访问地址:"
echo -e "${BLUE}• 主应用: http://localhost:8080${NC}"
echo -e "${BLUE}• API文档: http://localhost:8080/api-docs${NC}"
echo -e "${BLUE}• 集群状态: http://localhost:8080/cluster/status${NC}"
echo -e "${BLUE}• 健康检查: http://localhost:8080/health${NC}"
echo -e "${BLUE}• Prometheus: http://localhost:9090${NC}"
echo -e "${BLUE}• 直连App1: http://localhost:8102${NC}"
echo -e "${BLUE}• 直连App2: http://localhost:8103${NC}"
echo -e "${BLUE}• 直连App3: http://localhost:8104${NC}"

echo ""
echo "✅ 端口测试完成!"
