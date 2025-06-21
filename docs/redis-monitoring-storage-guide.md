# Redis监控存储配置指南

## 默认行为（推荐）

**从现在开始，系统默认禁用Redis监控数据存储**，这将显著降低Redis使用成本。

### 默认配置

- ✅ **监控指标数据**：只保存在内存中（保留1小时）
- ✅ **告警数据**：只保存在内存中，不写入Redis
- ✅ **实时告警通知**：正常工作（通过Redis发布/订阅）
- ✅ **实时监控**：正常工作（内存数据）

### 成本节省

- **监控数据写入**：100% 节省（完全禁用）
- **预计总体Redis成本**：节省 80-90%

## 如何启用Redis存储（可选）

如果你需要持久化监控数据到Redis，可以通过环境变量启用：

### 方法1：环境变量

```bash
# 启用Redis监控数据存储
export ENABLE_REDIS_METRICS_STORAGE=true

# 启用Redis告警数据存储  
export ENABLE_REDIS_ALERT_STORAGE=true
```

### 方法2：.env文件

在`.env`文件中添加：

```bash
ENABLE_REDIS_METRICS_STORAGE=true
ENABLE_REDIS_ALERT_STORAGE=true
```

## 功能对比

| 功能 | 默认模式（内存） | Redis存储模式 |
|------|------------------|---------------|
| 实时监控 | ✅ 正常 | ✅ 正常 |
| 告警通知 | ✅ 正常 | ✅ 正常 |
| 历史数据查询 | ⚠️ 1小时内 | ✅ 长期存储 |
| 重启后数据保留 | ❌ 丢失 | ✅ 保留 |
| Redis写入成本 | ✅ 极低 | ❌ 较高 |
| 内存使用 | ⚠️ 稍高 | ✅ 较低 |

## 验证配置

运行验证脚本检查当前配置：

```bash
cd packages/server
npx ts-node src/cluster/verify-monitoring-config.ts
```

## 监控API

查看当前监控配置和统计：

```bash
# 查看Redis去重统计
curl http://localhost:8102/cluster/redis-deduplication

# 查看集群状态
curl http://localhost:8102/cluster/status
```

## 推荐设置

### 生产环境（推荐）

```bash
# 成本优化模式
REDIS_COST_OPTIMIZATION=true

# 禁用Redis监控存储（默认）
# ENABLE_REDIS_METRICS_STORAGE=false  # 默认已禁用
# ENABLE_REDIS_ALERT_STORAGE=false    # 默认已禁用

# 延长监控间隔
MONITORING_METRICS_INTERVAL_PROD=600  # 10分钟
```

### 开发环境

```bash
# 如果需要调试历史数据，可以启用Redis存储
ENABLE_REDIS_METRICS_STORAGE=true
ENABLE_REDIS_ALERT_STORAGE=true

# 更频繁的监控
MONITORING_METRICS_INTERVAL_DEV=60    # 1分钟
```

## 迁移指南

### 从旧版本升级

如果你之前使用的是启用Redis存储的版本：

1. **无需任何操作**：新版本会自动使用内存存储
2. **保留历史数据**：如果需要保留历史数据，请在升级前备份Redis中的监控数据
3. **恢复Redis存储**：如果需要继续使用Redis存储，设置相应的环境变量

### 数据备份

如果需要备份现有的Redis监控数据：

```bash
# 备份监控指标数据
redis-cli --scan --pattern "metrics:*" | xargs redis-cli mget > metrics_backup.txt

# 备份告警数据
redis-cli --scan --pattern "alert:*" | xargs redis-cli mget > alerts_backup.txt
```

## 故障排除

### 监控数据丢失

**问题**：重启后监控数据消失
**解决**：这是正常行为（内存存储），如需持久化请启用Redis存储

### 告警历史为空

**问题**：无法查询历史告警
**解决**：启用`ENABLE_REDIS_ALERT_STORAGE=true`

### 成本仍然很高

**问题**：Redis成本没有明显降低
**解决**：
1. 运行验证脚本确认配置
2. 检查是否有其他组件在写入Redis
3. 查看Redis去重统计API

## 总结

新的默认配置将显著降低Redis使用成本，同时保持核心监控功能正常工作。对于大多数用户来说，内存存储已经足够满足实时监控需求。只有在需要长期历史数据分析时，才建议启用Redis存储。
