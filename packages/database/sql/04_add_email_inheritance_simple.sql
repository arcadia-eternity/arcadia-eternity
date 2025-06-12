-- 简化版邮箱继承功能数据库迁移
-- 执行日期: 2024-01-XX

-- 为现有玩家表添加邮箱相关字段
ALTER TABLE players 
ADD COLUMN IF NOT EXISTS email TEXT,
ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS email_bound_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS is_registered BOOLEAN DEFAULT FALSE;

-- 创建邮箱唯一索引（如果不存在）
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_email_unique ON players(email) WHERE email IS NOT NULL;

-- 创建邮箱验证码表
DROP TABLE IF EXISTS email_verification_codes;
CREATE TABLE email_verification_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    player_id TEXT NOT NULL,
    purpose TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '10 minutes'),
    used_at TIMESTAMPTZ
);

-- 添加约束
ALTER TABLE email_verification_codes 
ADD CONSTRAINT chk_purpose CHECK (purpose IN ('bind', 'recover'));

ALTER TABLE email_verification_codes 
ADD CONSTRAINT chk_code_length CHECK (char_length(code) = 6);

ALTER TABLE email_verification_codes 
ADD CONSTRAINT chk_email_format CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_email_verification_codes_email ON email_verification_codes(email);
CREATE INDEX IF NOT EXISTS idx_email_verification_codes_expires ON email_verification_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_email_verification_codes_player ON email_verification_codes(player_id);
CREATE INDEX IF NOT EXISTS idx_email_verification_codes_purpose ON email_verification_codes(purpose);

-- 创建清理过期验证码的函数
CREATE OR REPLACE FUNCTION cleanup_expired_verification_codes()
RETURNS void AS $$
BEGIN
    DELETE FROM email_verification_codes 
    WHERE expires_at < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql;

-- 添加注释
COMMENT ON TABLE email_verification_codes IS '邮箱验证码表，用于跨设备玩家ID继承功能';
COMMENT ON COLUMN players.email IS '玩家绑定的邮箱地址，用于跨设备继承（可选）';
COMMENT ON COLUMN players.email_verified IS '邮箱验证状态';
COMMENT ON COLUMN players.email_bound_at IS '邮箱绑定时间';
COMMENT ON COLUMN players.is_registered IS '是否为注册用户（绑定邮箱的用户为注册用户，否则为匿名用户）';

-- 验证表结构
\d players;
\d email_verification_codes;
