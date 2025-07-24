#!/usr/bin/env tsx

/**
 * ELO系统数据库迁移脚本
 * 创建ELO相关的表、函数和索引
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

async function main() {
  // 从环境变量获取Supabase配置
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ 缺少必要的环境变量:')
    console.error('   SUPABASE_URL')
    console.error('   SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  console.log('🚀 开始ELO系统数据库迁移...')

  // 创建Supabase客户端
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // 1. 创建ELO评级表
    console.log('📊 创建player_elo_ratings表...')
    const createTableSQL = `
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
    `

    const { error: createTableError } = await supabase.rpc('exec_sql', { sql: createTableSQL })
    if (createTableError) {
      // 尝试直接执行SQL
      const { error: directError } = await supabase.from('player_elo_ratings').select('*').limit(1)
      if (directError && directError.code === '42P01') {
        // 表不存在，需要手动创建
        console.error('❌ 无法创建表，请在Supabase SQL编辑器中手动执行以下SQL:')
        console.log(createTableSQL)
        process.exit(1)
      }
    }

    // 2. 创建索引
    console.log('🔍 创建索引...')
    const createIndexesSQL = `
      -- ELO评级表索引
      CREATE INDEX IF NOT EXISTS idx_player_elo_ratings_rule_set ON player_elo_ratings(rule_set_id);
      CREATE INDEX IF NOT EXISTS idx_player_elo_ratings_elo ON player_elo_ratings(rule_set_id, elo_rating DESC);
      CREATE INDEX IF NOT EXISTS idx_player_elo_ratings_games ON player_elo_ratings(rule_set_id, games_played DESC);
      CREATE INDEX IF NOT EXISTS idx_player_elo_ratings_updated ON player_elo_ratings(updated_at DESC);
    `

    const { error: indexError } = await supabase.rpc('exec_sql', { sql: createIndexesSQL })
    if (indexError) {
      console.warn('⚠️ 索引创建可能失败，请手动执行:', createIndexesSQL)
    }

    // 3. 创建函数
    console.log('⚙️ 创建数据库函数...')
    
    // 获取或创建玩家ELO评级记录函数
    const getOrCreateEloSQL = `
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
    `

    const { error: funcError1 } = await supabase.rpc('exec_sql', { sql: getOrCreateEloSQL })
    if (funcError1) {
      console.warn('⚠️ 函数创建可能失败，请手动执行get_or_create_player_elo函数')
    }

    console.log('✅ ELO系统数据库迁移完成!')
    console.log('')
    console.log('📋 迁移摘要:')
    console.log('   ✓ player_elo_ratings 表')
    console.log('   ✓ 相关索引')
    console.log('   ✓ get_or_create_player_elo 函数')
    console.log('')
    console.log('🎯 下一步: 启动服务器测试ELO功能')

  } catch (error) {
    console.error('❌ 迁移失败:', error)
    console.log('')
    console.log('🔧 手动迁移步骤:')
    console.log('1. 打开Supabase SQL编辑器')
    console.log('2. 执行 packages/database/sql/01_create_tables.sql 中的ELO相关部分')
    console.log('3. 执行 packages/database/sql/03_functions.sql 中的ELO相关函数')
    process.exit(1)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
