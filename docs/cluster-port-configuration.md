# 集群端口配置说明

## 端口映射总览

### 主要服务端口

| 服务 | 主机端口 | 容器端口 | 说明 |
|------|----------|----------|------|
| **Nginx负载均衡器** | 8080 | 80 | 主要访问入口 |
| **Nginx HTTPS** | 8443 | 443 | HTTPS访问入口 |
| **App1** | 8102 | 8102 | 应用实例1直连 |
| **App2** | 8103 | 8102 | 应用实例2直连 |
| **App3** | 8104 | 8102 | 应用实例3直连 |
| **Redis** | 6379 | 6379 | Redis数据库 |
| **Prometheus** | 9090 | 9090 | 监控服务 |
| **Grafana** | 3001 | 3000 | 监控仪表板 |

### 端口变更说明

**之前的配置问题：**
- Nginx使用端口80，可能与系统服务冲突
- 状态监控服务器使用8080，与新的Nginx端口冲突

**修复后的配置：**
- Nginx负载均衡器：`8080:80` (避免80端口冲突)
- Nginx状态监控：内部端口8081 (避免8080冲突)
- HTTPS端口：`8443:443` (避免443端口冲突)

## 访问地址

### 推荐访问方式 (通过负载均衡器)

```bash
# 主应用
http://localhost:8080

# API文档
http://localhost:8080/api-docs

# 健康检查
http://localhost:8080/health

# 集群状态
http://localhost:8080/cluster/status

# WebSocket连接
ws://localhost:8080/socket.io/
```

### 直连应用实例 (调试用)

```bash
# 应用实例1
http://localhost:8102

# 应用实例2  
http://localhost:8103

# 应用实例3
http://localhost:8104
```

### 监控服务

```bash
# Prometheus监控
http://localhost:9090

# Grafana仪表板 (需要启用monitoring profile)
http://localhost:3001
# 默认账号: admin/admin
```

## 前端配置

### 环境变量配置

**集群模式 (推荐):**
```env
VITE_API_BASE_URL=http://localhost:8080/api/v1
VITE_WS_URL=http://localhost:8080
```

**直连模式 (调试):**
```env
VITE_API_BASE_URL=http://localhost:8102/api/v1
VITE_WS_URL=http://localhost:8102
```

## 启动和测试

### 快速启动

```bash
# 一键启动集群
./tools/start-cluster.sh
```

### 手动启动

```bash
# 构建镜像
./docker-cluster-build.sh

# 启动集群
docker-compose -f docker-compose.cluster.yml up -d

# 查看状态
docker-compose -f docker-compose.cluster.yml ps
```

### 端口测试

```bash
# 测试所有端口
./tools/test-cluster-ports.sh
```

### 查看日志

```bash
# 查看所有服务日志
docker-compose -f docker-compose.cluster.yml logs -f

# 查看特定服务日志
docker-compose -f docker-compose.cluster.yml logs -f nginx
docker-compose -f docker-compose.cluster.yml logs -f app1
```

## 故障排除

### 端口冲突

如果遇到端口冲突，可以检查：

```bash
# 检查端口占用
lsof -i :8080
lsof -i :8102

# 停止冲突服务或修改端口配置
```

### 容器健康检查

```bash
# 检查容器健康状态
docker-compose -f docker-compose.cluster.yml ps

# 查看健康检查日志
docker inspect arcadia-nginx --format='{{.State.Health}}'
```

### 网络连接测试

```bash
# 测试负载均衡器
curl http://localhost:8080/health

# 测试应用实例
curl http://localhost:8102/health
curl http://localhost:8103/health  
curl http://localhost:8104/health

# 测试WebSocket
curl http://localhost:8080/socket.io/
```

## 生产环境建议

1. **使用标准端口**: 在生产环境中，建议使用标准的80/443端口
2. **SSL证书**: 配置HTTPS证书
3. **防火墙**: 只开放必要的端口
4. **监控**: 启用Prometheus和Grafana监控
5. **日志**: 配置日志聚合和持久化存储
