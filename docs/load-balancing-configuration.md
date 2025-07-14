# 负载均衡配置指南

本文档介绍如何配置智能负载均衡系统，以优化战斗实例分配和集群资源利用率。

## 概述

智能负载均衡系统基于多维度性能指标来选择最佳实例创建战斗，包括：
- CPU使用率
- 内存使用率
- 活跃战斗数量
- 连接数
- 平均响应时间
- 错误率

## 配置方式

### 1. 环境变量配置

可以通过环境变量来配置负载均衡参数：

#### 权重配置
```bash
# CPU使用率权重 (默认: 0.25)
LB_WEIGHT_CPU=0.25

# 内存使用率权重 (默认: 0.20)
LB_WEIGHT_MEMORY=0.20

# 活跃战斗数权重 (默认: 0.25)
LB_WEIGHT_BATTLES=0.25

# 连接数权重 (默认: 0.15)
LB_WEIGHT_CONNECTIONS=0.15

# 响应时间权重 (默认: 0.10)
LB_WEIGHT_RESPONSE_TIME=0.10

# 错误率权重 (默认: 0.05)
LB_WEIGHT_ERROR_RATE=0.05
```

#### 阈值配置
```bash
# CPU高负载阈值，百分比 (默认: 80)
LB_THRESHOLD_CPU_HIGH=80

# 内存高负载阈值，百分比 (默认: 85)
LB_THRESHOLD_MEMORY_HIGH=85

# 最大战斗数阈值 (默认: 100)
LB_THRESHOLD_BATTLES_MAX=100

# 最大连接数阈值 (默认: 1000)
LB_THRESHOLD_CONNECTIONS_MAX=1000

# 最大响应时间阈值，毫秒 (默认: 5000)
LB_THRESHOLD_RESPONSE_TIME_MAX=5000

# 最大错误率阈值 (默认: 0.1)
LB_THRESHOLD_ERROR_RATE_MAX=0.1
```

#### 其他配置
```bash
# 是否优先选择同区域实例 (默认: true)
LB_PREFER_SAME_REGION=true

# 是否启用阈值过滤 (默认: true)
LB_ENABLE_THRESHOLD_FILTERING=true
```

### 2. 代码配置

也可以通过代码动态配置：

```typescript
import { loadBalancingConfigManager } from './cluster/loadBalancingConfig'

// 更新权重配置
loadBalancingConfigManager.updateConfig({
  weights: {
    cpu: 0.3,
    memory: 0.25,
    battles: 0.2,
    connections: 0.15,
    responseTime: 0.08,
    errorRate: 0.02,
  }
})

// 更新阈值配置
loadBalancingConfigManager.updateConfig({
  thresholds: {
    cpuHigh: 75,
    memoryHigh: 80,
    battlesMax: 150,
    connectionsMax: 1500,
    responseTimeMax: 3000,
    errorRateMax: 0.05,
  }
})
```

## 配置说明

### 权重配置

权重决定了各项指标在实例选择中的重要性：

- **CPU权重**: CPU使用率对实例选择的影响程度
- **内存权重**: 内存使用率对实例选择的影响程度
- **战斗权重**: 活跃战斗数对实例选择的影响程度
- **连接权重**: 连接数对实例选择的影响程度
- **响应时间权重**: 平均响应时间对实例选择的影响程度
- **错误率权重**: 错误率对实例选择的影响程度

**注意**: 所有权重的总和应该等于1.0，系统会自动标准化权重。

### 阈值配置

阈值用于过滤高负载实例：

- **CPU阈值**: 超过此CPU使用率的实例将被过滤（除非所有实例都超过）
- **内存阈值**: 超过此内存使用率的实例将被过滤
- **战斗数阈值**: 超过此活跃战斗数的实例将被过滤
- **连接数阈值**: 超过此连接数的实例将被过滤
- **响应时间阈值**: 超过此响应时间的实例将被过滤
- **错误率阈值**: 超过此错误率的实例将被过滤

### 其他配置

- **区域优先**: 启用时，优先选择同区域的实例以降低延迟
- **阈值过滤**: 启用时，会过滤掉超过阈值的高负载实例

## 配置示例

### 高性能配置
适用于对响应时间要求极高的场景：

```bash
LB_WEIGHT_CPU=0.35
LB_WEIGHT_MEMORY=0.25
LB_WEIGHT_BATTLES=0.15
LB_WEIGHT_CONNECTIONS=0.10
LB_WEIGHT_RESPONSE_TIME=0.15
LB_WEIGHT_ERROR_RATE=0.00

LB_THRESHOLD_CPU_HIGH=70
LB_THRESHOLD_MEMORY_HIGH=75
LB_THRESHOLD_RESPONSE_TIME_MAX=2000
```

### 高可用配置
适用于对稳定性要求极高的场景：

```bash
LB_WEIGHT_CPU=0.20
LB_WEIGHT_MEMORY=0.20
LB_WEIGHT_BATTLES=0.20
LB_WEIGHT_CONNECTIONS=0.15
LB_WEIGHT_RESPONSE_TIME=0.10
LB_WEIGHT_ERROR_RATE=0.15

LB_THRESHOLD_ERROR_RATE_MAX=0.05
LB_ENABLE_THRESHOLD_FILTERING=true
```

### 均衡配置
适用于一般场景的平衡配置：

```bash
LB_WEIGHT_CPU=0.25
LB_WEIGHT_MEMORY=0.20
LB_WEIGHT_BATTLES=0.25
LB_WEIGHT_CONNECTIONS=0.15
LB_WEIGHT_RESPONSE_TIME=0.10
LB_WEIGHT_ERROR_RATE=0.05

LB_THRESHOLD_CPU_HIGH=80
LB_THRESHOLD_MEMORY_HIGH=85
LB_THRESHOLD_BATTLES_MAX=100
```

## 监控和调优

### 监控指标

系统会自动收集以下指标用于负载均衡决策：

1. **实例性能指标**
   - CPU使用率
   - 内存使用率
   - 活跃战斗数
   - 连接数
   - 平均响应时间
   - 错误率

2. **负载均衡效果指标**
   - 实例选择分布
   - 负载分散效果
   - 系统整体性能

### 调优建议

1. **根据业务特点调整权重**
   - CPU密集型应用增加CPU权重
   - 内存密集型应用增加内存权重
   - 高并发应用增加连接数权重

2. **根据硬件配置调整阈值**
   - 高性能服务器可以设置更高的阈值
   - 低配置服务器应该设置更保守的阈值

3. **定期监控和调整**
   - 观察负载分布是否均匀
   - 监控系统整体性能指标
   - 根据实际情况调整配置

## 故障排除

### 常见问题

1. **所有实例都被过滤**
   - 检查阈值设置是否过于严格
   - 考虑临时禁用阈值过滤

2. **负载分布不均**
   - 检查权重配置是否合理
   - 确认性能指标收集是否正常

3. **配置不生效**
   - 确认环境变量设置正确
   - 检查配置更新是否被正确应用

### 调试方法

1. **查看当前配置**
```typescript
console.log(loadBalancingConfigManager.toJSON())
```

2. **监听配置更新**
```typescript
loadBalancingConfigManager.onConfigUpdate((config) => {
  console.log('Config updated:', config)
})
```

3. **重置配置**
```typescript
loadBalancingConfigManager.resetToDefault()
```
