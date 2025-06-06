-- 数据库函数用于复杂查询和数据处理

-- 获取玩家战报列表（分页）
CREATE OR REPLACE FUNCTION get_player_battle_records(
    p_player_id TEXT,
    p_limit INTEGER DEFAULT 20,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    id TEXT,
    opponent_id TEXT,
    opponent_name TEXT,
    is_winner BOOLEAN,
    battle_result TEXT,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    duration_seconds INTEGER
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        br.id,
        CASE 
            WHEN br.player_a_id = p_player_id THEN br.player_b_id
            ELSE br.player_a_id
        END as opponent_id,
        CASE 
            WHEN br.player_a_id = p_player_id THEN br.player_b_name
            ELSE br.player_a_name
        END as opponent_name,
        br.winner_id = p_player_id as is_winner,
        br.battle_result,
        br.started_at,
        br.ended_at,
        br.duration_seconds
    FROM battle_records br
    WHERE br.player_a_id = p_player_id OR br.player_b_id = p_player_id
    ORDER BY br.started_at DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$;

-- 获取排行榜
CREATE OR REPLACE FUNCTION get_leaderboard(
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    player_id TEXT,
    player_name TEXT,
    total_battles INTEGER,
    wins INTEGER,
    losses INTEGER,
    draws INTEGER,
    win_rate NUMERIC
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ps.player_id,
        p.name as player_name,
        ps.total_battles,
        ps.wins,
        ps.losses,
        ps.draws,
        CASE 
            WHEN ps.total_battles > 0 THEN 
                ROUND((ps.wins::NUMERIC / ps.total_battles::NUMERIC) * 100, 2)
            ELSE 0
        END as win_rate
    FROM player_stats ps
    JOIN players p ON ps.player_id = p.id
    WHERE ps.total_battles > 0
    ORDER BY ps.wins DESC, win_rate DESC, ps.total_battles DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$;

-- 获取战报统计信息
CREATE OR REPLACE FUNCTION get_battle_statistics()
RETURNS TABLE (
    total_battles BIGINT,
    total_players BIGINT,
    battles_today BIGINT,
    battles_this_week BIGINT,
    avg_battle_duration NUMERIC
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*) as total_battles,
        (SELECT COUNT(DISTINCT player_a_id) + COUNT(DISTINCT player_b_id) FROM battle_records) as total_players,
        COUNT(*) FILTER (WHERE started_at >= CURRENT_DATE) as battles_today,
        COUNT(*) FILTER (WHERE started_at >= DATE_TRUNC('week', CURRENT_DATE)) as battles_this_week,
        ROUND(AVG(duration_seconds), 2) as avg_battle_duration
    FROM battle_records
    WHERE ended_at IS NOT NULL;
END;
$$;

-- 搜索玩家
CREATE OR REPLACE FUNCTION search_players(
    p_search_term TEXT,
    p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
    id TEXT,
    name TEXT,
    total_battles INTEGER,
    wins INTEGER,
    win_rate NUMERIC
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id,
        p.name,
        COALESCE(ps.total_battles, 0) as total_battles,
        COALESCE(ps.wins, 0) as wins,
        CASE 
            WHEN COALESCE(ps.total_battles, 0) > 0 THEN 
                ROUND((COALESCE(ps.wins, 0)::NUMERIC / ps.total_battles::NUMERIC) * 100, 2)
            ELSE 0
        END as win_rate
    FROM players p
    LEFT JOIN player_stats ps ON p.id = ps.player_id
    WHERE p.name ILIKE '%' || p_search_term || '%'
    ORDER BY ps.wins DESC NULLS LAST, p.name
    LIMIT p_limit;
END;
$$;

-- 清理旧的未完成战报（可选，用于定期清理）
CREATE OR REPLACE FUNCTION cleanup_abandoned_battles(
    p_hours_threshold INTEGER DEFAULT 24
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    affected_rows INTEGER;
BEGIN
    UPDATE battle_records 
    SET 
        ended_at = NOW(),
        battle_result = 'abandoned',
        end_reason = 'timeout'
    WHERE 
        ended_at IS NULL 
        AND started_at < NOW() - INTERVAL '1 hour' * p_hours_threshold;
    
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    RETURN affected_rows;
END;
$$;
