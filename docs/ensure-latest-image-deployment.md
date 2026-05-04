# 确保始终使用最新镜像部署

本文档说明如何确保 Fly.io 部署始终使用最新构建的 Docker 镜像。

## 🎯 问题背景

在 CI/CD 流程中，可能会遇到以下问题：

- **Docker 缓存问题**: 使用固定标签 (如 `:main`) 时，Docker 和 Fly.io 会使用缓存的旧版本
- **标签重用**: 相同的标签可能指向不同的镜像内容，导致版本不一致
- **缓存层**: Fly.io 和 Docker Registry 的多层缓存可能导致拉取到旧镜像
- **--no-cache 缺失**: 不使用 `--no-cache` 参数时，始终拉不到最新镜像

## ✅ 解决方案

我们采用了多层策略来彻底解决缓存问题：

### 1. 唯一镜像标识

**构建阶段** - 生成多种标签:

```yaml
tags: |
  type=ref,event=branch          # main
  type=sha,prefix={{branch}}-    # main-abc1234
  type=raw,value=main,enable={{is_default_branch}}
  type=raw,value=latest,enable={{is_default_branch}}
```

**部署阶段** - 智能选择镜像引用:

```bash
# 自动触发时：使用 SHA 标签 (main-abc1234)
IMAGE_REF="${IMAGE_NAME}:main-${SHORT_SHA}"

# 手动触发时：使用 digest (@sha256:...)
IMAGE_REF="${IMAGE_NAME}@${DIGEST}"
```

### 2. 绕过所有缓存层

**关键策略**:

- ✅ **SHA 标签**: `main-abc1234` 每次构建都是唯一的
- ✅ **镜像 Digest**: `@sha256:...` 指向确切的镜像内容
- ✅ **动态引用**: 运行时确定镜像引用，不依赖固定标签
- ✅ **强制拉取**: `--image` 参数强制 Fly.io 拉取指定镜像

### 3. 智能镜像选择逻辑

```bash
if [ "${{ github.event_name }}" = "workflow_run" ]; then
  # 自动触发：使用基于 commit SHA 的唯一标签
  COMMIT_SHA="${{ github.event.workflow_run.head_sha }}"
  SHORT_SHA=$(echo $COMMIT_SHA | cut -c1-7)
  IMAGE_REF="${IMAGE_NAME}:main-${SHORT_SHA}"
else
  # 手动触发：获取最新 digest 绕过缓存
  DIGEST=$(docker manifest inspect ${IMAGE_NAME}:main | jq -r '.config.digest')
  IMAGE_REF="${IMAGE_NAME}@${DIGEST}"
fi
```

## 🔍 验证方法

### 1. 检查部署日志

在 GitHub Actions 中会看到：

```text
Using SHA-based tag: ghcr.io/owner/repo:main-abc1234
This ensures we get the exact image built from commit: abc1234567890
```

### 2. 验证应用版本

```bash
# 检查应用是否响应
curl https://test-battle.fly.dev/health

# 查看部署历史
flyctl releases --app test-battle
```

### 3. 检查镜像信息

```bash
# 查看当前部署的镜像信息
flyctl status --app test-battle

# 查看具体的镜像引用
flyctl releases --app test-battle -j | jq '.[0].config.image'
```

## 🛠️ 高级解决方案

### 方案1: 强制无缓存部署

如果仍有问题，可以添加强制无缓存选项：

```bash
flyctl deploy --image "$IMAGE_REF" --no-cache --remote-only
```

### 方案2: 时间戳标签

为每个构建添加时间戳：

```yaml
- name: Generate timestamp tag
  run: |
    TIMESTAMP=$(date +%Y%m%d-%H%M%S)
    echo "timestamp-tag=main-${TIMESTAMP}" >> $GITHUB_OUTPUT
```

## 🔧 故障排除

### 问题1: SHA 标签不存在

**症状**: 部署失败，提示找不到 `main-abc1234` 标签
**解决方案**: 检查构建工作流是否正确生成了 SHA 标签

### 问题2: Digest 获取失败

**症状**: 手动触发时无法获取镜像 digest
**解决方案**: 确保已正确登录到 GitHub Container Registry

### 问题3: 仍然使用旧镜像

**症状**: 即使使用了新的解决方案，仍然部署旧版本
**解决方案**:

1. 检查镜像是否正确推送
2. 验证 SHA 或 digest 是否正确
3. 使用 `--no-cache` 强制刷新

## 📊 效果对比

| 方法                     | 缓存问题      | 唯一性      | 可靠性        |
| ------------------------ | ------------- | ----------- | ------------- |
| 固定标签 `:main`         | ❌ 有缓存问题 | ❌ 不唯一   | ❌ 不可靠     |
| SHA 标签 `:main-abc1234` | ✅ 无缓存问题 | ✅ 完全唯一 | ✅ 高可靠性   |
| Digest `@sha256:...`     | ✅ 无缓存问题 | ✅ 内容唯一 | ✅ 最高可靠性 |

## 📚 相关资源

- [Docker 镜像标签最佳实践](https://docs.docker.com/develop/dev-best-practices/)
- [Fly.io 部署文档](https://fly.io/docs/apps/deploy/)
- [GitHub Container Registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
