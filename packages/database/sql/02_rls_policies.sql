-- RLS 策略配置文件
-- 用于配置 Supabase 数据库的行级安全策略
-- 支持服务端操作和用户权限控制

-- ============================================================================
-- 清理现有策略
-- ============================================================================

-- 删除玩家表的现有策略
DROP POLICY IF EXISTS "Players can insert own record" ON players;
DROP POLICY IF EXISTS "Players can insert own record or service can insert any" ON players;
DROP POLICY IF EXISTS "Players can view all records" ON players;
DROP POLICY IF EXISTS "Players can view all records or service can view any" ON players;
DROP POLICY IF EXISTS "Players can update own record" ON players;
DROP POLICY IF EXISTS "Players can update own record or service can update any" ON players;

-- 删除玩家统计表的现有策略
DROP POLICY IF EXISTS "Only system can modify stats" ON player_stats;
DROP POLICY IF EXISTS "Only service can modify stats" ON player_stats;
DROP POLICY IF EXISTS "Anyone can view player stats" ON player_stats;
DROP POLICY IF EXISTS "Anyone can view player stats or service can view any" ON player_stats;

-- 删除战报记录表的现有策略
DROP POLICY IF EXISTS "Battle participants can create records" ON battle_records;
DROP POLICY IF EXISTS "Battle participants or service can create records" ON battle_records;
DROP POLICY IF EXISTS "Anyone can view battle records" ON battle_records;
DROP POLICY IF EXISTS "Anyone can view battle records or service can view any" ON battle_records;
DROP POLICY IF EXISTS "Only system can update battle records" ON battle_records;
DROP POLICY IF EXISTS "Only service can update battle records" ON battle_records;

-- ============================================================================
-- 启用 RLS
-- ============================================================================

-- 确保所有表都启用了 RLS
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE battle_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_verification_codes ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 玩家表 (players) 策略
-- ============================================================================

-- 插入策略：玩家可以插入自己的记录，服务端可以插入任何记录
CREATE POLICY "Players can insert own record or service can insert any" ON players
    FOR INSERT WITH CHECK (
        auth.uid()::text = id OR 
        auth.role() = 'service_role' OR
        auth.uid() IS NULL  -- 允许无认证的服务端操作
    );

-- 查看策略：所有人可以查看玩家基本信息
CREATE POLICY "Players can view all records or service can view any" ON players
    FOR SELECT USING (
        true OR  -- 允许所有人查看基本信息
        auth.role() = 'service_role' OR
        auth.uid() IS NULL  -- 允许无认证的服务端操作
    );

-- 更新策略：玩家只能更新自己的记录，服务端可以更新任何记录
CREATE POLICY "Players can update own record or service can update any" ON players
    FOR UPDATE USING (
        auth.uid()::text = id OR
        auth.role() = 'service_role' OR
        auth.uid() IS NULL  -- 允许无认证的服务端操作
    );

-- ============================================================================
-- 玩家统计表 (player_stats) 策略
-- ============================================================================

-- 查看策略：所有人可以查看玩家统计信息
CREATE POLICY "Anyone can view player stats or service can view any" ON player_stats
    FOR SELECT USING (
        true OR  -- 允许所有人查看统计信息
        auth.role() = 'service_role' OR
        auth.uid() IS NULL  -- 允许无认证的服务端操作
    );

-- 修改策略：只有服务端可以修改统计信息（通过触发器自动更新）
CREATE POLICY "Only service can modify stats" ON player_stats
    FOR ALL USING (
        auth.role() = 'service_role' OR
        auth.uid() IS NULL  -- 允许无认证的服务端操作
    );

-- ============================================================================
-- 战报记录表 (battle_records) 策略
-- ============================================================================

-- 插入策略：参与战斗的玩家或服务端可以创建战报记录
CREATE POLICY "Battle participants or service can create records" ON battle_records
    FOR INSERT WITH CHECK (
        auth.uid()::text = player_a_id OR 
        auth.uid()::text = player_b_id OR
        auth.role() = 'service_role' OR
        auth.uid() IS NULL  -- 允许无认证的服务端操作
    );

-- 查看策略：所有人可以查看战报记录
CREATE POLICY "Anyone can view battle records or service can view any" ON battle_records
    FOR SELECT USING (
        true OR  -- 允许所有人查看战报
        auth.role() = 'service_role' OR
        auth.uid() IS NULL  -- 允许无认证的服务端操作
    );

-- 更新策略：只有服务端可以更新战报记录
CREATE POLICY "Only service can update battle records" ON battle_records
    FOR UPDATE USING (
        auth.role() = 'service_role' OR
        auth.uid() IS NULL  -- 允许无认证的服务端操作
    );

-- ============================================================================
-- 验证策略设置
-- ============================================================================

-- 查看当前策略状态
DO $$
DECLARE
    policy_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO policy_count
    FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename IN ('players', 'player_stats', 'battle_records');
    
    RAISE NOTICE 'Total RLS policies created: %', policy_count;
    
    -- 验证每个表的策略数量
    SELECT COUNT(*) INTO policy_count FROM pg_policies WHERE tablename = 'players';
    RAISE NOTICE 'Players table policies: %', policy_count;
    
    SELECT COUNT(*) INTO policy_count FROM pg_policies WHERE tablename = 'player_stats';
    RAISE NOTICE 'Player_stats table policies: %', policy_count;
    
    SELECT COUNT(*) INTO policy_count FROM pg_policies WHERE tablename = 'battle_records';
    RAISE NOTICE 'Battle_records table policies: %', policy_count;

    SELECT COUNT(*) INTO policy_count FROM pg_policies WHERE tablename = 'email_verification_codes';
    RAISE NOTICE 'Email_verification_codes table policies: %', policy_count;
END $$;

-- ============================================================================
-- 邮箱验证码表 (email_verification_codes) 策略
-- ============================================================================

-- 插入策略：只有服务端可以创建验证码
CREATE POLICY "Only service can create verification codes" ON email_verification_codes
    FOR INSERT WITH CHECK (
        auth.role() = 'service_role' OR
        auth.uid() IS NULL  -- 允许无认证的服务端操作
    );

-- 查看策略：只有服务端可以查看验证码（安全考虑）
CREATE POLICY "Only service can view verification codes" ON email_verification_codes
    FOR SELECT USING (
        auth.role() = 'service_role' OR
        auth.uid() IS NULL  -- 允许无认证的服务端操作
    );

-- 更新策略：只有服务端可以更新验证码状态
CREATE POLICY "Only service can update verification codes" ON email_verification_codes
    FOR UPDATE USING (
        auth.role() = 'service_role' OR
        auth.uid() IS NULL  -- 允许无认证的服务端操作
    );

-- 删除策略：只有服务端可以删除验证码
CREATE POLICY "Only service can delete verification codes" ON email_verification_codes
    FOR DELETE USING (
        auth.role() = 'service_role' OR
        auth.uid() IS NULL  -- 允许无认证的服务端操作
    );

-- ============================================================================
-- 使用说明
-- ============================================================================

/*
使用方法：
1. 在 Supabase SQL 编辑器中执行此文件
2. 或者使用 psql 命令行：
   psql -h your-host -U postgres -d postgres -f rls_policies.sql

策略说明：
- 服务端（service_role）可以执行所有操作
- 无认证上下文（auth.uid() IS NULL）的操作被允许，用于服务端
- 用户可以查看所有公开信息
- 用户只能修改自己的数据
- 统计信息只能由服务端修改

安全考虑：
- 生产环境建议进一步限制查看权限
- 可以根据需要添加更细粒度的权限控制
- 定期审查和更新策略
*/
