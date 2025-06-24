# CLI数据验证功能

## 概述

为CLI添加了类似webui的数据ID验证功能，以防止ID出现空引用的情况。该功能包括：

1. **数据完整性检查** - 验证各类数据是否正确加载
2. **ID格式验证** - 检查ID是否符合预期格式
3. **重复ID检查** - 确保ID在全局范围内唯一
4. **交叉引用验证** - 验证数据间的引用关系
5. **增强的错误处理** - 提供详细的错误信息和建议

## 新增功能

### 1. CLI数据验证模块 (`@arcadia-eternity/cli-validator`)

创建了专门的数据验证模块，提供以下功能：

- `CLIDataValidator` - 主要验证器类
- `validateGameData()` - 便捷验证函数
- `validateAndPrintGameData()` - 验证并打印结果的函数

### 2. 增强的玩家数据解析

改进了 `parsePlayerFile` 函数，添加了：

- 文件存在性检查
- YAML格式验证
- 基本数据结构验证
- 精灵数据完整性检查
- 种族ID格式验证

### 3. CLI命令集成

为所有主要CLI命令添加了 `--validate-data` 选项：

- `local` - 本地对战命令
- `online` - 在线对战命令
- `server` - 服务器启动命令

### 4. 专用验证命令

新增了专门的 `validate` 命令，用于单独进行数据验证：

- `validate` - 专门的数据验证命令，支持多种验证选项

## 使用方法

### 基本用法

```bash
# 专门的数据验证命令（推荐）
pnpm cli validate

# 启动本地对战并验证数据
pnpm cli local --player1 player1.yaml --player2 player2.yaml --validate-data

# 启动在线对战并验证数据
pnpm cli online --data player.yaml --validate-data

# 启动服务器并验证数据
pnpm cli server --validate-data
```

### 专用验证命令选项

```bash
# 基本验证
pnpm cli validate

# 严格模式验证（包含交叉引用检查）
pnpm cli validate --strict

# 加载脚本后验证
pnpm cli validate --load-scripts

# 跳过ID格式验证（适用于开发阶段）
pnpm cli validate --skip-id-format

# 跳过重复ID检查
pnpm cli validate --skip-duplicates

# 发现错误时继续验证
pnpm cli validate --continue-on-error

# 显示详细验证信息
pnpm cli validate --verbose

# 组合使用多个选项
pnpm cli validate --strict --load-scripts --verbose
```

### 严格模式

在 `local` 命令中，`--strict` 选项会自动启用数据验证：

```bash
# 严格模式会自动进行数据验证
pnpm cli local --player1 player1.yaml --player2 player2.yaml --strict
```

## 验证内容

### 1. 基本数据完整性

- 检查效果、标记、技能、物种数据是否正确加载
- 确保各类数据不为空

### 2. ID格式验证

- **物种ID**: 必须以 `pet_` 开头
- **技能ID**: 必须以 `skill_` 开头
- **标记ID**: 必须以 `mark_` 开头
- **效果ID**: 必须以 `effect_` 开头

### 3. 重复ID检查

- 检查是否有跨类型的重复ID
- 确保所有ID在全局范围内唯一

### 4. 交叉引用验证

- 验证技能引用的效果是否存在
- 验证标记引用的效果是否存在
- 验证物种引用的能力和徽章标记是否存在

### 5. 玩家数据验证

- 检查玩家名称是否有效
- 验证队伍数据结构
- 检查精灵数据完整性
- 验证种族ID格式

## 错误报告

验证失败时，系统会提供详细的错误信息：

```
[❌] 数据验证失败，发现 2 个错误

[INVALID_FORMAT] 4 个错误:
  - 物种ID "example_species" 格式不正确，应该以 "pet_" 开头
  - 技能ID "example_skill" 格式不正确，应该以 "skill_" 开头
  - 标记ID "example_mark" 格式不正确，应该以 "mark_" 开头
  - 效果ID "example_effect" 格式不正确，应该以 "effect_" 开头

[MISSING_REFERENCE] 1 个错误:
  - 技能 "skill_paida" 引用了不存在的效果 "effect_nonexistent"
```

## 配置选项

`CLIDataValidator` 支持以下配置选项：

```typescript
interface DataValidationOptions {
  validateCrossReferences?: boolean  // 是否验证交叉引用
  validateIdFormat?: boolean         // 是否验证ID格式
  checkDuplicateIds?: boolean        // 是否检查重复ID
  continueOnError?: boolean          // 是否在发现错误时继续验证
  verbose?: boolean                  // 是否显示详细的验证信息
}
```

## 性能考虑

- 验证过程在数据加载完成后进行
- 对于大型数据集，验证可能需要几秒钟时间
- 可以通过 `--validate-data` 选项选择性启用

## 最佳实践

1. **开发阶段**: 使用 `pnpm cli validate` 定期检查数据完整性
2. **数据修改**: 修改游戏数据后立即运行 `pnpm cli validate --strict`
3. **脚本开发**: 开发脚本时使用 `pnpm cli validate --load-scripts --skip-id-format`
4. **生产环境**: 在服务器启动时进行一次验证
5. **CI/CD**: 在构建流程中集成 `pnpm cli validate --strict` 命令

## 故障排除

### 常见错误

1. **ID格式错误**: 确保物种ID以 `pet_` 开头，技能ID以 `skill_` 开头，标记ID以 `mark_` 开头，效果ID以 `effect_` 开头
2. **缺失引用**: 检查被引用的效果、标记是否存在
3. **重复ID**: 确保所有ID在全局范围内唯一
4. **文件格式**: 确保YAML文件格式正确

### 调试技巧

- 使用 `--verbose` 选项获取详细信息
- 检查数据加载日志中的错误信息
- 逐个修复验证报告中的错误

## 示例

### 成功验证

```bash
$ pnpm cli validate
[🔍] 开始游戏数据验证...
[🌀] 正在加载游戏数据...
[🔍] 正在验证游戏数据完整性...
[✅] 数据验证通过
[🎉] 所有数据验证通过！
```

### 验证失败

```bash
$ pnpm cli validate --load-scripts
[🔍] 开始游戏数据验证...
[🌀] 正在加载游戏数据...
[🔍] 正在验证游戏数据完整性...
[❌] 数据验证失败，发现 4 个错误
[💥] 数据验证失败，请修复上述问题
```

## 相关文件

- `packages/cli-validator/` - 验证模块源码
- `bin/cli.ts` - CLI主文件，集成了验证功能
- `docs/cli-data-validation.md` - 本文档
