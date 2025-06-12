-- 添加跨设备玩家ID继承功能的数据库迁移
-- 执行日期: 2024-01-XX

-- 为现有玩家表添加邮箱相关字段
ALTER TABLE players
ADD COLUMN IF NOT EXISTS email TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS email_bound_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS is_registered BOOLEAN DEFAULT FALSE;

-- 添加邮箱格式约束（先检查是否存在）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'players_email_format'
        AND conrelid = 'players'::regclass
    ) THEN
        ALTER TABLE players
        ADD CONSTRAINT players_email_format
        CHECK (email IS NULL OR email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');
    END IF;
END $$;

-- 添加注册状态一致性约束（先检查是否存在）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'players_registration_consistency'
        AND conrelid = 'players'::regclass
    ) THEN
        ALTER TABLE players
        ADD CONSTRAINT players_registration_consistency
        CHECK (
            (is_registered = FALSE AND email IS NULL AND email_verified = FALSE AND email_bound_at IS NULL) OR
            (is_registered = TRUE AND email IS NOT NULL AND email_verified = TRUE AND email_bound_at IS NOT NULL)
        );
    END IF;
END $$;

-- 创建邮箱验证码表
CREATE TABLE IF NOT EXISTS email_verification_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    player_id TEXT NOT NULL, -- 必需，每个验证码都对应一个玩家ID
    purpose TEXT NOT NULL CHECK (purpose IN ('bind', 'recover')), -- 验证码用途：绑定或恢复
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '10 minutes'),
    used_at TIMESTAMPTZ,

    -- 索引和约束
    CONSTRAINT email_verification_codes_email_format CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
    CONSTRAINT email_verification_codes_code_length CHECK (char_length(code) = 6)
);

-- 创建相关索引
CREATE INDEX IF NOT EXISTS idx_players_email ON players(email);
CREATE INDEX IF NOT EXISTS idx_email_verification_codes_email ON email_verification_codes(email);
CREATE INDEX IF NOT EXISTS idx_email_verification_codes_expires ON email_verification_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_email_verification_codes_player ON email_verification_codes(player_id);

-- 创建清理过期验证码的函数
CREATE OR REPLACE FUNCTION cleanup_expired_verification_codes()
RETURNS void AS $$
BEGIN
    DELETE FROM email_verification_codes 
    WHERE expires_at < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql;

-- 创建定时清理任务（需要 pg_cron 扩展，可选）
-- SELECT cron.schedule('cleanup-verification-codes', '0 * * * *', 'SELECT cleanup_expired_verification_codes();');

COMMENT ON TABLE email_verification_codes IS '邮箱验证码表，用于跨设备玩家ID继承功能';
COMMENT ON COLUMN players.email IS '玩家绑定的邮箱地址，用于跨设备继承（可选）';
COMMENT ON COLUMN players.email_verified IS '邮箱验证状态';
COMMENT ON COLUMN players.email_bound_at IS '邮箱绑定时间';
COMMENT ON COLUMN players.is_registered IS '是否为注册用户（绑定邮箱的用户为注册用户，否则为匿名用户）';
