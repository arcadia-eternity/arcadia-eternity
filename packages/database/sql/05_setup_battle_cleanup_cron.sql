-- 设置战报清理的定时任务
-- 需要 pg_cron 扩展支持

-- 创建 pg_cron 扩展（如果尚未创建）
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 每天凌晨 2 点清理超过 7 天的战报记录
-- cron 表达式: '0 2 * * *' 表示每天凌晨 2:00
SELECT cron.schedule(
    'cleanup-old-battle-records',
    '0 2 * * *',
    'SELECT cleanup_old_battle_records(7);'
);

-- 每小时清理超过 24 小时未完成的战报
-- cron 表达式: '0 * * * *' 表示每小时的第 0 分钟
SELECT cron.schedule(
    'cleanup-abandoned-battles',
    '0 * * * *',
    'SELECT cleanup_abandoned_battles(24);'
);

-- 查看已设置的定时任务
-- SELECT * FROM cron.job;

-- 如果需要删除定时任务，可以使用以下命令：
-- SELECT cron.unschedule('cleanup-old-battle-records');
-- SELECT cron.unschedule('cleanup-abandoned-battles');
