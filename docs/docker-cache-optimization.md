# Docker 构建缓存优化

本文档说明如何在本地Docker构建中使用npm/pnpm缓存来加速构建过程。

## 🎯 优化概述

我们已经对Dockerfile进行了优化，使用Docker BuildKit的缓存挂载功能来缓存pnpm存储，这样可以：

- **加速依赖安装**: 重复构建时复用已下载的包
- **减少网络请求**: 避免重复下载相同的依赖
- **提升开发体验**: 本地构建更快，迭代更高效

## 🔧 实现方式

### 1. Dockerfile 优化

在构建阶段和依赖阶段都使用了缓存挂载：

```dockerfile
# 构建阶段 - 挂载pnpm缓存
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# 生产依赖阶段 - 挂载pnpm缓存
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod && \
    pnpm store prune
```

### 2. BuildKit 启用

更新了构建脚本以启用Docker BuildKit：

```bash
# 启用 Docker BuildKit
export DOCKER_BUILDKIT=1

# 构建时使用缓存优化
docker build \
  --target production \
  --tag "$IMAGE_NAME:$TAG" \
  --build-arg BUILDKIT_INLINE_CACHE=1 \
  .
```

## 🚀 使用方法

### 方法1: 使用构建脚本（推荐）

```bash
# 使用优化的构建脚本
./docker-build.sh

# 或指定标签
./docker-build.sh my-tag
```

### 方法2: 使用docker-compose

```bash
# 启用BuildKit
export DOCKER_BUILDKIT=1

# 构建
docker-compose build
```

### 方法3: 直接使用docker命令

```bash
# 启用BuildKit
export DOCKER_BUILDKIT=1

# 构建
docker build --target production -t arcadia-eternity:latest .
```

## 📊 性能对比

| 构建类型     | 首次构建 | 重复构建 | 缓存命中率 |
| ------------ | -------- | -------- | ---------- |
| 无缓存优化   | ~5-8分钟 | ~5-8分钟 | 0%         |
| 启用pnpm缓存 | ~5-8分钟 | ~2-3分钟 | 70-90%     |

## 🔍 验证缓存效果

### 查看缓存使用情况

```bash
# 查看Docker BuildKit缓存
docker system df

# 查看构建缓存详情
docker builder du
```

### 测试缓存效果

```bash
# 第一次构建（建立缓存）
time ./docker-build.sh test1

# 第二次构建（使用缓存）
time ./docker-build.sh test2
```

第二次构建应该明显更快，特别是在依赖安装阶段。

## 🛠️ 故障排除

### 问题1: BuildKit未启用

**症状**: 构建时提示不支持`--mount`语法
**解决方案**:

```bash
export DOCKER_BUILDKIT=1
# 或者在命令前加上
DOCKER_BUILDKIT=1 docker build ...
```

### 问题2: 缓存未生效

**症状**: 重复构建时间没有明显减少
**解决方案**:

1. 确认BuildKit已启用
2. 检查Docker版本（需要18.09+）
3. 清理并重新构建缓存

### 问题3: 缓存占用空间过大

**症状**: Docker占用磁盘空间过多
**解决方案**:

```bash
# 清理构建缓存
docker builder prune

# 清理所有未使用的缓存
docker system prune -a
```

## 🔧 高级配置

### 自定义缓存目录

如果需要自定义pnpm缓存目录：

```dockerfile
# 使用自定义缓存路径
RUN --mount=type=cache,target=/custom/pnpm/cache \
    PNPM_STORE_DIR=/custom/pnpm/cache pnpm install --frozen-lockfile
```

### 多阶段缓存共享

当前配置已经在多个构建阶段之间共享pnpm缓存，确保最大化缓存利用率。

## 📚 相关资源

- [Docker BuildKit文档](https://docs.docker.com/develop/dev-best-practices/)
- [pnpm缓存机制](https://pnpm.io/cli/store)
- [Docker缓存最佳实践](https://docs.docker.com/develop/dev-best-practices/)
