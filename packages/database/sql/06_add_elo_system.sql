-- ELO评级系统数据库迁移
-- 为每个规则集单独维护ELO评级

-- 玩家ELO评级表（按规则集分离）
CREATE TABLE IF NOT EXISTS player_elo_ratings (
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    rule_set_id TEXT NOT NULL,
    elo_rating INTEGER DEFAULT 1200 CHECK (elo_rating >= 0),
    games_played INTEGER DEFAULT 0 CHECK (games_played >= 0),
    wins INTEGER DEFAULT 0 CHECK (wins >= 0),
    losses INTEGER DEFAULT 0 CHECK (losses >= 0),
    draws INTEGER DEFAULT 0 CHECK (draws >= 0),
    highest_elo INTEGER DEFAULT 1200 CHECK (highest_elo >= 0),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- 复合主键确保每个玩家在每个规则集下只有一条记录
    PRIMARY KEY (player_id, rule_set_id),
    
    -- 确保统计数据一致性
    CONSTRAINT elo_stats_consistency CHECK (games_played = wins + losses + draws),
    -- 确保最高ELO不低于当前ELO的历史最低值
    CONSTRAINT elo_highest_valid CHECK (highest_elo >= elo_rating OR games_played = 0)
);

-- ELO评级表索引
CREATE INDEX IF NOT EXISTS idx_player_elo_ratings_rule_set ON player_elo_ratings(rule_set_id);
CREATE INDEX IF NOT EXISTS idx_player_elo_ratings_elo ON player_elo_ratings(rule_set_id, elo_rating DESC);
CREATE INDEX IF NOT EXISTS idx_player_elo_ratings_games ON player_elo_ratings(rule_set_id, games_played DESC);
CREATE INDEX IF NOT EXISTS idx_player_elo_ratings_updated ON player_elo_ratings(updated_at DESC);

-- 获取或创建玩家ELO评级记录
CREATE OR REPLACE FUNCTION get_or_create_player_elo(
    p_player_id TEXT,
    p_rule_set_id TEXT,
    p_initial_elo INTEGER DEFAULT 1200
)
RETURNS TABLE (
    player_id TEXT,
    rule_set_id TEXT,
    elo_rating INTEGER,
    games_played INTEGER,
    wins INTEGER,
    losses INTEGER,
    draws INTEGER,
    highest_elo INTEGER,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    -- 尝试获取现有记录
    RETURN QUERY
    SELECT 
        per.player_id,
        per.rule_set_id,
        per.elo_rating,
        per.games_played,
        per.wins,
        per.losses,
        per.draws,
        per.highest_elo,
        per.created_at,
        per.updated_at
    FROM player_elo_ratings per
    WHERE per.player_id = p_player_id AND per.rule_set_id = p_rule_set_id;
    
    -- 如果没有找到记录，创建新记录
    IF NOT FOUND THEN
        INSERT INTO player_elo_ratings (
            player_id, 
            rule_set_id, 
            elo_rating, 
            highest_elo
        ) VALUES (
            p_player_id, 
            p_rule_set_id, 
            p_initial_elo, 
            p_initial_elo
        );
        
        -- 返回新创建的记录
        RETURN QUERY
        SELECT 
            per.player_id,
            per.rule_set_id,
            per.elo_rating,
            per.games_played,
            per.wins,
            per.losses,
            per.draws,
            per.highest_elo,
            per.created_at,
            per.updated_at
        FROM player_elo_ratings per
        WHERE per.player_id = p_player_id AND per.rule_set_id = p_rule_set_id;
    END IF;
END;
$$;

-- 更新玩家ELO评级
CREATE OR REPLACE FUNCTION update_player_elo(
    p_player_id TEXT,
    p_rule_set_id TEXT,
    p_new_elo INTEGER,
    p_result TEXT -- 'win', 'loss', 'draw'
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    current_highest INTEGER;
BEGIN
    -- 获取当前最高ELO
    SELECT highest_elo INTO current_highest
    FROM player_elo_ratings
    WHERE player_id = p_player_id AND rule_set_id = p_rule_set_id;
    
    -- 更新ELO评级和统计
    UPDATE player_elo_ratings
    SET 
        elo_rating = p_new_elo,
        games_played = games_played + 1,
        wins = wins + CASE WHEN p_result = 'win' THEN 1 ELSE 0 END,
        losses = losses + CASE WHEN p_result = 'loss' THEN 1 ELSE 0 END,
        draws = draws + CASE WHEN p_result = 'draw' THEN 1 ELSE 0 END,
        highest_elo = GREATEST(COALESCE(current_highest, p_new_elo), p_new_elo),
        updated_at = NOW()
    WHERE player_id = p_player_id AND rule_set_id = p_rule_set_id;
END;
$$;

-- 获取规则集ELO排行榜
CREATE OR REPLACE FUNCTION get_elo_leaderboard(
    p_rule_set_id TEXT,
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    player_id TEXT,
    player_name TEXT,
    elo_rating INTEGER,
    games_played INTEGER,
    wins INTEGER,
    losses INTEGER,
    draws INTEGER,
    win_rate NUMERIC,
    highest_elo INTEGER
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        per.player_id,
        p.name as player_name,
        per.elo_rating,
        per.games_played,
        per.wins,
        per.losses,
        per.draws,
        CASE 
            WHEN per.games_played > 0 THEN 
                ROUND((per.wins::NUMERIC / per.games_played::NUMERIC) * 100, 2)
            ELSE 0
        END as win_rate,
        per.highest_elo
    FROM player_elo_ratings per
    JOIN players p ON per.player_id = p.id
    WHERE per.rule_set_id = p_rule_set_id
    ORDER BY per.elo_rating DESC, per.games_played DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$;

-- 批量更新玩家ELO评级（用于战斗结束后的原子更新）
CREATE OR REPLACE FUNCTION batch_update_player_elos(
    updates JSONB
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    update_record JSONB;
    current_highest INTEGER;
BEGIN
    -- 遍历更新记录
    FOR update_record IN SELECT * FROM jsonb_array_elements(updates)
    LOOP
        -- 获取当前最高ELO
        SELECT highest_elo INTO current_highest
        FROM player_elo_ratings
        WHERE player_id = (update_record->>'player_id')::TEXT 
        AND rule_set_id = (update_record->>'rule_set_id')::TEXT;
        
        -- 更新ELO评级和统计
        UPDATE player_elo_ratings
        SET 
            elo_rating = (update_record->>'new_elo')::INTEGER,
            games_played = games_played + 1,
            wins = wins + CASE WHEN (update_record->>'result')::TEXT = 'win' THEN 1 ELSE 0 END,
            losses = losses + CASE WHEN (update_record->>'result')::TEXT = 'loss' THEN 1 ELSE 0 END,
            draws = draws + CASE WHEN (update_record->>'result')::TEXT = 'draw' THEN 1 ELSE 0 END,
            highest_elo = GREATEST(
                COALESCE(current_highest, (update_record->>'new_elo')::INTEGER), 
                (update_record->>'new_elo')::INTEGER
            ),
            updated_at = NOW()
        WHERE player_id = (update_record->>'player_id')::TEXT 
        AND rule_set_id = (update_record->>'rule_set_id')::TEXT;
    END LOOP;
END;
$$;

-- 添加ELO评级表的RLS策略
-- 查看策略：所有人可以查看ELO评级信息
CREATE POLICY "Anyone can view elo ratings or service can view any" ON player_elo_ratings
    FOR SELECT USING (
        true OR  -- 允许所有人查看ELO评级信息
        auth.role() = 'service_role' OR
        auth.uid() IS NULL  -- 允许无认证的服务端操作
    );

-- 修改策略：只有服务端可以修改ELO评级信息
CREATE POLICY "Only service can modify elo ratings" ON player_elo_ratings
    FOR ALL USING (
        auth.role() = 'service_role' OR
        auth.uid() IS NULL  -- 允许无认证的服务端操作
    );

-- 启用RLS
ALTER TABLE player_elo_ratings ENABLE ROW LEVEL SECURITY;
