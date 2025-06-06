# 战报功能故障排除指南

本文档记录了战报功能的常见问题和解决方案。

## 问题1: PostgreSQL nanoid() 函数不存在

### 错误信息

```
ERROR: 42883: function nanoid() does not exist
LINE 34: id TEXT PRIMARY KEY DEFAULT nanoid(),
HINT: No function matches the given name and argument types.
```

### 原因

Supabase PostgreSQL 默认没有 `nanoid()` 函数，而我们的 SQL 文件中使用了这个函数。

### 解决方案

✅ **已修复**: 将 SQL 文件中的 `nanoid()` 替换为 PostgreSQL 内置的 `gen_random_uuid()::text`

**修改文件**: `packages/database/sql/01_create_tables.sql`

```sql
-- 修改前
id TEXT PRIMARY KEY DEFAULT nanoid(),

-- 修改后  
id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
```

**相关修改**:

- 移除了 `packages/database/src/repositories/battleRepository.ts` 中对 nanoid 的依赖
- 让数据库自动生成 UUID，应用层不再手动生成 ID

## 问题2: 战报记录时序问题

### 问题描述

服务器创建战斗房间时，战报记录的创建是异步的，但战斗消息的记录是同步的。这导致在战报记录创建完成之前，战斗消息可能已经开始记录，造成消息丢失。

### 原因

在 `createBattleRoom` 方法中：

```typescript
// 问题代码 - 异步创建战报记录
if (this.battleReportService) {
  this.battleReportService.startBattleRecord(...)
    .then(recordId => {
      // 这里是异步的，可能在战斗开始后才执行
      room.battleRecordId = recordId
    })
}

// 立即注册战斗消息监听器
[player1, player2].forEach(p => {
  p.playerData.registerListener((message: BattleMessage) => {
    // 这里可能在 battleRecordId 设置之前就开始执行
    this.battleReportService.recordBattleMessage(roomId, message)
  })
})
```

### 解决方案

✅ **已修复**: 将 `createBattleRoom` 方法改为异步，同步等待战报记录创建完成

**修改文件**: `packages/server/src/server.ts`

```typescript
// 修改后 - 同步等待战报记录创建
private async createBattleRoom(p1, p2) {
  // ... 其他代码

  let battleRecordId: string | undefined
  if (this.battleReportService) {
    try {
      battleRecordId = await this.battleReportService.startBattleRecord(
        roomId,
        player1.playerData.id,
        player1.playerData.name,
        player2.playerData.id,
        player2.playerData.name,
      ) || undefined
      
      if (battleRecordId) {
        logger.info({ roomId, battleRecordId }, 'Battle record started successfully')
      }
    } catch (error) {
      logger.error({ error, roomId }, 'Failed to start battle record')
    }
  }

  // 现在可以安全地注册消息监听器
  // ...
}
```

**相关修改**:

- `attemptMatchmaking` 方法中的 `tryMatch` 函数改为异步
- 调用 `createBattleRoom` 的地方添加 `await`
- 添加了详细的日志记录以便诊断问题
- 只有在战报记录成功创建时才记录战斗消息

## 问题3: 端口配置不一致

### 问题描述

前端 API 配置的端口与后端服务器默认端口不一致，导致前端无法正确访问战报 API。

### 原因

- CLI 默认端口: `8102`
- 前端 API URL: `http://localhost:3001/api/v1`

### 解决方案

✅ **已修复**: 统一所有配置文件使用端口 `8102`

**修改文件**:

- `packages/web-ui/src/services/battleReportService.ts`
- `packages/web-ui/.env.example`
- `.env.example`
- `examples/start-server-with-battle-reports.sh`
- `docs/cli-battle-reports-usage.md`
- `package.json` 中的开发脚本

## 问题4: "Attempted to record message for unknown battle" 警告

### 问题描述

服务器日志中出现大量 "Attempted to record message for unknown battle" 警告，表示战斗消息无法记录到对应的战报中。

### 原因

即使战报记录创建失败，战斗消息监听器仍然会尝试记录消息，但此时 `activeBattles` 中没有对应的记录。

### 解决方案

✅ **已修复**: 添加条件检查，只有在战报记录成功创建时才记录战斗消息

**修改文件**: `packages/server/src/server.ts`

```typescript
// 修改后 - 条件检查
;[player1, player2].forEach(p => {
  p.playerData.registerListener((message: BattleMessage) => {
    // 只有在战报记录成功创建时才记录消息
    if (this.battleReportService && battleRecordId) {
      this.battleReportService.recordBattleMessage(roomId, message)
    } else if (this.battleReportService && !battleRecordId) {
      logger.debug({ roomId, messageType: message.type }, 'Skipping message recording - no battle record')
    }
    // ...
  })
})
```

**相关改进**:

- 添加了详细的日志记录以便诊断问题
- 改进了错误信息，包含更多上下文
- 在 `BattleReportService` 中添加了调试日志

## 问题5: 战报记录架构优化

### 问题描述

原始实现中，服务器分别监听每个玩家的消息监听器，导致：

1. 每条消息被记录两次（重复记录）
2. 战报记录的消息可能不包含完整信息（隐藏了对手信息）
3. 代码逻辑复杂且容易出错

### 解决方案

✅ **已修复**: 采用双重监听器架构

**修改文件**: `packages/server/src/server.ts`

```typescript
// 创建 Battle 时启用 showHidden，确保包含完整信息
const battle = new Battle(player1.playerData, player2.playerData, { showHidden: true })

// 监听 Battle 对象的消息用于战报记录（包含完整信息）
battle.registerListener((message: BattleMessage) => {
  // 记录战斗消息到战报（包含所有隐藏信息）
  if (this.battleReportService && battleRecordId) {
    this.battleReportService.recordBattleMessage(roomId, message)
  }

  // 处理战斗结束
  if (message.type === BattleMessageType.BattleEnd) {
    this.cleanupRoom(roomId)
  }
})

// 分别监听每个玩家的消息用于发送给客户端（各自视角）
;[player1, player2].forEach(p => {
  p.playerData.registerListener((message: BattleMessage) => {
    // 向该玩家发送他们视角的战斗事件
    p.socket.emit('battleEvent', message)
  })
})
```

**架构优势**:

- **战报记录**: 使用 Battle 全局监听器，包含完整信息（showHidden: true）
- **玩家消息**: 使用各自的 Player 监听器，只包含该玩家可见的信息
- **避免重复**: 每条消息只被记录一次到战报
- **信息完整**: 战报包含所有隐藏信息，便于后续分析和回放

## 问题6: RLS 策略阻止服务端操作

### 问题描述

服务器尝试创建玩家记录或战报记录时失败，错误信息：

```
"code":"42501","message":"new row violates row-level security policy for table \"players\""
```

### 原因

Supabase 的行级安全策略（RLS）默认只允许认证用户操作自己的数据，但游戏服务器是以服务端身份运行的，没有用户认证上下文。

### 解决方案

✅ **已修复**: 修改 RLS 策略允许服务端操作

**修复脚本**:

```bash
# 推荐：使用新的 RLS 策略文件
pnpm fix:rls:apply

# 或者：使用旧的修复脚本
pnpm fix:rls
```

**手动修复**: 在 Supabase SQL 编辑器中执行以下 SQL：

```sql
-- 删除现有策略
DROP POLICY IF EXISTS "Players can insert own record" ON players;
DROP POLICY IF EXISTS "Only system can modify stats" ON player_stats;
DROP POLICY IF EXISTS "Battle participants can create records" ON battle_records;
DROP POLICY IF EXISTS "Only system can update battle records" ON battle_records;

-- 创建新策略（允许服务端操作）
CREATE POLICY "Players can insert own record or service can insert any" ON players
    FOR INSERT WITH CHECK (
        auth.uid()::text = id OR
        auth.role() = 'service_role' OR
        auth.uid() IS NULL  -- 允许无认证的服务端操作
    );

CREATE POLICY "Only service can modify stats" ON player_stats
    FOR ALL USING (
        auth.role() = 'service_role' OR
        auth.uid() IS NULL  -- 允许无认证的服务端操作
    );

CREATE POLICY "Battle participants or service can create records" ON battle_records
    FOR INSERT WITH CHECK (
        auth.uid()::text = player_a_id OR
        auth.uid()::text = player_b_id OR
        auth.role() = 'service_role' OR
        auth.uid() IS NULL  -- 允许无认证的服务端操作
    );

CREATE POLICY "Only service can update battle records" ON battle_records
    FOR UPDATE USING (
        auth.role() = 'service_role' OR
        auth.uid() IS NULL  -- 允许无认证的服务端操作
    );
```

**关键改进**:

- 允许 `service_role` 执行所有操作
- 允许无认证上下文（`auth.uid() IS NULL`）的服务端操作
- 保持原有的用户权限控制

**临时解决方案**（仅用于开发测试）:

```bash
# 快速禁用 RLS（临时解决方案）
pnpm fix:rls:disable

# 测试禁用后的效果
pnpm test:rls:after-disable
```

**注意**: 临时禁用 RLS 仅适用于开发和测试环境，生产环境必须使用正确的 RLS 策略。

**新的 RLS 策略文件**:
项目现在包含一个完整的 RLS 策略文件 `packages/database/sql/rls_policies.sql`，它提供：

- 完整的策略清理和重建
- 支持服务端操作的策略
- 详细的验证和测试
- 使用说明和安全考虑

**使用新策略文件**:

```bash
# 应用新的 RLS 策略文件
pnpm fix:rls:apply

# 测试新策略效果
pnpm test:rls:new
```

## 测试和验证

### 新增测试脚本

1. **SQL 语法测试**

   ```bash
   pnpm test:sql
   ```

   验证 SQL 文件语法正确性，确保不包含 nanoid 函数

2. **战报记录功能测试**

   ```bash
   pnpm test:battle-recording
   ```

   模拟完整的战斗流程，验证战报记录功能

3. **端口配置验证**

   ```bash
   pnpm test:config
   ```

   验证所有配置文件中的端口设置一致性

4. **调试模式**

   ```bash
   pnpm debug:battle-reports
   ```

   启动调试模式服务器，实时查看战报功能状态

5. **战报修复验证**

   ```bash
   pnpm test:battle-fix
   ```

   验证 "unknown battle" 警告是否已修复

6. **RLS 策略修复**

   ```bash
   pnpm fix:rls
   ```

   修复数据库行级安全策略，允许服务端操作

7. **最终综合测试**

   ```bash
   pnpm test:battle-reports:final
   ```

   运行完整的战报功能测试

### 验证步骤

1. **数据库连接测试**

   ```bash
   # 设置环境变量
   export SUPABASE_URL="https://your-project.supabase.co"
   export SUPABASE_ANON_KEY="your-anon-key"
   
   # 运行数据库测试
   pnpm test:database
   ```

2. **完整战报功能测试**

   ```bash
   # 运行所有战报相关测试
   pnpm test:battle-reports
   ```

3. **手动验证**

   ```bash
   # 启动调试服务器
   pnpm debug:battle-reports
   
   # 在另一个终端检查 API
   curl http://localhost:8097/health
   curl http://localhost:8097/api/v1/statistics
   ```

## 最佳实践

### 开发环境设置

1. **环境变量配置**

   ```bash
   # .env 文件
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_KEY=your-service-key
   PORT=8102
   ```

2. **启动开发服务器**

   ```bash
   # 带战报功能的开发服务器
   pnpm dev:server:battle-reports
   ```

3. **前端开发**

   ```bash
   # 确保前端 API 配置正确
   # packages/web-ui/.env.local
   VITE_API_BASE_URL=http://localhost:8102/api/v1
   ```

### 生产部署

1. **数据库迁移**
   - 确保执行了所有 SQL 迁移脚本
   - 验证 `uuid-ossp` 扩展已启用
   - 检查 RLS 策略正确配置

2. **服务器配置**

   ```bash
   # 生产环境启动
   NODE_ENV=production node dist/cli.js server \
     --port 8102 \
     --enable-battle-reports \
     --supabase-url "$SUPABASE_URL" \
     --supabase-anon-key "$SUPABASE_ANON_KEY" \
     --supabase-service-key "$SUPABASE_SERVICE_KEY"
   ```

3. **监控和日志**
   - 监控战报记录成功率
   - 检查数据库连接状态
   - 定期清理废弃的战报记录

## 常见问题

### Q: 战报记录创建失败

**A**: 检查 Supabase 配置和网络连接，确保服务密钥有足够权限

### Q: 前端无法访问战报 API

**A**: 验证端口配置一致性，检查 CORS 设置

### Q: 数据库 UUID 生成失败

**A**: 确保 `uuid-ossp` 扩展已启用，检查 SQL 文件语法

### Q: 战斗消息丢失

**A**: 确保使用修复后的异步战报记录创建逻辑

## 相关文档

- [CLI 战报功能使用指南](./cli-battle-reports-usage.md)
- [测试指南](./testing-guide.md)
- [数据库 README](../packages/database/README.md)
