#!/bin/bash

# 集群启动脚本
# 自动构建镜像、启动集群并测试端口

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 启动Arcadia Eternity集群...${NC}"

# 检查Docker是否运行
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker未运行，请先启动Docker${NC}"
    exit 1
fi

# 停止现有容器
echo -e "${YELLOW}🛑 停止现有容器...${NC}"
docker-compose -f docker-compose.cluster.yml down || true

# 构建镜像
echo -e "${BLUE}🔨 构建集群镜像...${NC}"
if [ -f "./docker-cluster-build.sh" ]; then
    ./docker-cluster-build.sh
else
    docker build -t arcadia-eternity:cluster .
fi

# 启动集群
echo -e "${GREEN}🚀 启动集群服务...${NC}"
docker-compose -f docker-compose.cluster.yml up -d

# 等待服务启动
echo -e "${YELLOW}⏳ 等待服务启动...${NC}"
sleep 10

# 检查容器状态
echo -e "${BLUE}📋 检查容器状态...${NC}"
docker-compose -f docker-compose.cluster.yml ps

# 等待健康检查通过
echo -e "${YELLOW}🏥 等待健康检查通过...${NC}"
for i in {1..30}; do
    if docker-compose -f docker-compose.cluster.yml ps | grep -q "healthy"; then
        echo -e "${GREEN}✅ 服务健康检查通过${NC}"
        break
    fi
    echo -n "."
    sleep 2
done

echo ""

# 运行端口测试
echo -e "${BLUE}🔍 运行端口测试...${NC}"
if [ -f "./tools/test-cluster-ports.sh" ]; then
    ./tools/test-cluster-ports.sh
else
    echo -e "${YELLOW}⚠️  端口测试脚本不存在，跳过测试${NC}"
fi

echo ""
echo -e "${GREEN}🎉 集群启动完成！${NC}"
echo ""
echo -e "${BLUE}📱 访问地址:${NC}"
echo -e "• 主应用 (Nginx负载均衡): ${GREEN}http://localhost:8080${NC}"
echo -e "• API文档: ${GREEN}http://localhost:8080/api-docs${NC}"
echo -e "• 集群状态: ${GREEN}http://localhost:8080/cluster/status${NC}"
echo -e "• 健康检查: ${GREEN}http://localhost:8080/health${NC}"
echo ""
echo -e "${BLUE}🔧 直连应用实例:${NC}"
echo -e "• App1: ${GREEN}http://localhost:8102${NC}"
echo -e "• App2: ${GREEN}http://localhost:8103${NC}"
echo -e "• App3: ${GREEN}http://localhost:8104${NC}"
echo ""
echo -e "${BLUE}📊 监控服务:${NC}"
echo -e "• Prometheus: ${GREEN}http://localhost:9090${NC}"
echo -e "• Redis: ${GREEN}localhost:6379${NC}"
echo ""
echo -e "${YELLOW}💡 提示:${NC}"
echo -e "• 查看日志: ${BLUE}docker-compose -f docker-compose.cluster.yml logs -f${NC}"
echo -e "• 停止集群: ${BLUE}docker-compose -f docker-compose.cluster.yml down${NC}"
echo -e "• 重启集群: ${BLUE}./tools/start-cluster.sh${NC}"
