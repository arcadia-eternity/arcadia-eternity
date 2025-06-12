# 战报清理系统

## 概述

战报系统实现了自动清理机制，确保数据库不会因为历史战报数据过多而影响性能。系统会自动清理超过7天的战报记录，并在前端界面提示用户这一政策。

## 清理策略

### 1. 七天自动清理

- **清理对象**: 所有超过7天的战报记录
- **清理时间**: 每天凌晨2点自动执行
- **实现方式**: 使用 PostgreSQL 的 pg_cron 扩展

### 2. 废弃战报清理

- **清理对象**: 超过24小时未完成的战报（状态为未结束的战报）
- **清理时间**: 每小时执行一次
- **处理方式**: 将状态标记为 `abandoned`，结束原因设为 `timeout`

## 数据库实现

### 清理函数

```sql
-- 清理超过指定天数的战报记录
CREATE OR REPLACE FUNCTION cleanup_old_battle_records(
    p_days_threshold INTEGER DEFAULT 7
)
RETURNS INTEGER;

-- 清理废弃的战报
CREATE OR REPLACE FUNCTION cleanup_abandoned_battles(
    p_hours_threshold INTEGER DEFAULT 24
)
RETURNS INTEGER;
```

### 定时任务

```sql
-- 每天凌晨2点清理超过7天的战报
SELECT cron.schedule(
    'cleanup-old-battle-records',
    '0 2 * * *',
    'SELECT cleanup_old_battle_records(7);'
);

-- 每小时清理超过24小时未完成的战报
SELECT cron.schedule(
    'cleanup-abandoned-battles',
    '0 * * * *',
    'SELECT cleanup_abandoned_battles(24);'
);
```

## 前端提示

在战报列表页面添加了明显的提示信息，告知用户战报的7天有效期：

- 在战报列表顶部显示信息提示框
- 使用国际化支持，可以根据语言设置显示相应文本
- 提示内容：战报记录将在7天后自动清理，请及时查看或保存重要的战斗记录

## 手动清理

提供了手动清理脚本用于测试和维护：

```bash
# 清理超过7天的战报记录
tsx packages/database/scripts/cleanup-battle-records.ts old

# 清理超过24小时未完成的战报
tsx packages/database/scripts/cleanup-battle-records.ts abandoned

# 执行所有清理操作
tsx packages/database/scripts/cleanup-battle-records.ts all
```

## 配置要求

### 数据库扩展

需要安装 `pg_cron` 扩展：

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
```

### 环境变量

清理脚本需要以下环境变量：

- `SUPABASE_URL`: Supabase 项目 URL
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase 服务角色密钥

## 监控和日志

- 定时任务执行结果会记录在 PostgreSQL 日志中
- 可以通过查询 `cron.job_run_details` 表查看执行历史
- 手动清理脚本会输出清理的记录数量

## 注意事项

1. **数据不可恢复**: 清理的战报数据将永久删除，无法恢复
2. **性能影响**: 清理操作在低峰时段（凌晨2点）执行，减少对系统性能的影响
3. **用户通知**: 前端界面明确告知用户7天清理政策
4. **备份建议**: 如需长期保存重要战报，建议用户及时导出或截图保存

## 故障排除

### 定时任务未执行

1. 检查 pg_cron 扩展是否正确安装
2. 确认数据库用户有执行权限
3. 查看 PostgreSQL 日志获取错误信息

### 清理脚本执行失败

1. 检查环境变量是否正确设置
2. 确认数据库连接权限
3. 查看脚本输出的错误信息
