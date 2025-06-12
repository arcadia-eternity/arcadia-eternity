-- 游戏战报系统数据库表结构
-- 使用 Supabase PostgreSQL

-- 启用必要的扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 玩家信息表
CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_login_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb,
    email TEXT UNIQUE, -- 邮箱绑定字段，用于跨设备继承（可选）
    email_verified BOOLEAN DEFAULT FALSE, -- 邮箱验证状态
    email_bound_at TIMESTAMPTZ, -- 邮箱绑定时间
    is_registered BOOLEAN DEFAULT FALSE, -- 是否为注册用户（绑定邮箱的用户）

    -- 索引和约束
    CONSTRAINT players_name_length CHECK (char_length(name) >= 1 AND char_length(name) <= 50),
    CONSTRAINT players_email_format CHECK (email IS NULL OR email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
    -- 注册用户必须有邮箱，匿名用户不能有邮箱
    CONSTRAINT players_registration_consistency CHECK (
        (is_registered = FALSE AND email IS NULL AND email_verified = FALSE AND email_bound_at IS NULL) OR
        (is_registered = TRUE AND email IS NOT NULL AND email_verified = TRUE AND email_bound_at IS NOT NULL)
    )
);

-- 玩家统计表
CREATE TABLE IF NOT EXISTS player_stats (
    player_id TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
    total_battles INTEGER DEFAULT 0 CHECK (total_battles >= 0),
    wins INTEGER DEFAULT 0 CHECK (wins >= 0),
    losses INTEGER DEFAULT 0 CHECK (losses >= 0),
    draws INTEGER DEFAULT 0 CHECK (draws >= 0),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- 确保统计数据一致性
    CONSTRAINT stats_consistency CHECK (total_battles = wins + losses + draws)
);

-- 战报记录表
CREATE TABLE IF NOT EXISTS battle_records (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    
    -- 参与玩家信息
    player_a_id TEXT NOT NULL REFERENCES players(id),
    player_a_name TEXT NOT NULL,
    player_b_id TEXT NOT NULL REFERENCES players(id),
    player_b_name TEXT NOT NULL,
    
    -- 时间信息
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    duration_seconds INTEGER CHECK (duration_seconds > 0),
    
    -- 战斗结果
    winner_id TEXT REFERENCES players(id),
    battle_result TEXT NOT NULL CHECK (battle_result IN ('player_a_wins', 'player_b_wins', 'draw', 'abandoned')),
    end_reason TEXT NOT NULL CHECK (end_reason IN ('all_pet_fainted', 'surrender', 'timeout', 'disconnect')),
    
    -- 战斗数据
    battle_messages JSONB NOT NULL DEFAULT '[]'::jsonb,
    final_state JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- 索引和约束
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT different_players CHECK (player_a_id != player_b_id),
    CONSTRAINT valid_winner CHECK (
        winner_id IS NULL OR 
        winner_id = player_a_id OR 
        winner_id = player_b_id
    ),
    CONSTRAINT ended_battles_have_duration CHECK (
        (ended_at IS NULL AND duration_seconds IS NULL) OR
        (ended_at IS NOT NULL AND duration_seconds IS NOT NULL)
    )
);

-- 创建索引以优化查询性能
CREATE INDEX IF NOT EXISTS idx_battle_records_player_a ON battle_records(player_a_id);
CREATE INDEX IF NOT EXISTS idx_battle_records_player_b ON battle_records(player_b_id);
CREATE INDEX IF NOT EXISTS idx_battle_records_winner ON battle_records(winner_id);
CREATE INDEX IF NOT EXISTS idx_battle_records_started_at ON battle_records(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_battle_records_ended_at ON battle_records(ended_at DESC);
CREATE INDEX IF NOT EXISTS idx_battle_records_result ON battle_records(battle_result);

-- 复合索引用于玩家战报查询
CREATE INDEX IF NOT EXISTS idx_battle_records_player_time ON battle_records(player_a_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_battle_records_player_b_time ON battle_records(player_b_id, started_at DESC);

-- 邮箱验证码表（用于跨设备ID继承）
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
    CONSTRAINT email_verification_codes_code_length CHECK (char_length(code) = 6),
    -- 确保同一邮箱同一时间只能有一个有效的验证码（通过唯一索引实现）
    CONSTRAINT unique_active_code UNIQUE (email, purpose) DEFERRABLE INITIALLY DEFERRED
);

-- 玩家表索引
CREATE INDEX IF NOT EXISTS idx_players_name ON players(name);
CREATE INDEX IF NOT EXISTS idx_players_email ON players(email);
CREATE INDEX IF NOT EXISTS idx_players_created_at ON players(created_at DESC);

-- 统计表索引
CREATE INDEX IF NOT EXISTS idx_player_stats_wins ON player_stats(wins DESC);
CREATE INDEX IF NOT EXISTS idx_player_stats_total ON player_stats(total_battles DESC);

-- 邮箱验证码表索引
CREATE INDEX IF NOT EXISTS idx_email_verification_codes_email ON email_verification_codes(email);
CREATE INDEX IF NOT EXISTS idx_email_verification_codes_expires ON email_verification_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_email_verification_codes_player ON email_verification_codes(player_id);
