# V2 → V1 战斗回归基线（#201）

关联：[#200](https://github.com/arcadia-eternity/arcadia-eternity/issues/200)、[#201](https://github.com/arcadia-eternity/arcadia-eternity/issues/201)。

基准提交：`1492b2ca`（3.4.2，建立分支时最新 main）。V1 参考：`c086289812885e7a4903b181e2b8989e201452b8`。

**V1 行为是验收规范**（用户于 2026-10-16 确认）。V2 golden 记录现有实现的可复现观测；与 V1 冲突的部分属于 V2 待修复缺陷，不能凭更新 golden 改写规范。本轮只添加测试、fixture、CI 和文档。

## 运行与更新

在仓库根目录，Node 24、pnpm 11.21.0：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm --filter @arcadia-eternity/battle... --filter @arcadia-eternity/pack-loader... run build
pnpm test:battle-baseline
pnpm typecheck:battle-baseline
pnpm lint
pnpm lint:battle-baseline
```

测试运行只读取本地官方包；无需服务器、Redis、数据库、账号、DOM 或浏览器。首次安装依赖需要包缓存或网络。CI 使用同样命令，`CI=true`，没有 service containers、服务凭证或部署步骤。构建依赖图是必要步骤：workspace 包入口指向 dist，不能依赖其他工作目录遗留的构建产物。

仅运行新增样例：

```sh
pnpm --filter @arcadia-eternity/battle run test:run v2-golden-battle.test.ts v2-baseline-known-defects.test.ts --maxWorkers=2
```

经审查确认行为变化后才更新快照：

```sh
pnpm --filter @arcadia-eternity/battle run test:run v2-golden-battle.test.ts --maxWorkers=1 -u
```

检查动作、伤害、怒气、印记和结局的具体 diff。V1 语义修复应同时移除对应的 `test.fails`、更新本报告与受影响的 V2 观测值；意外通过的 `test.fails` 会让套件失败，要求显式审查。

## 既有测试与入口盘点

基准提交的 `packages/battle/src/v2/__tests__` 有 **17 个自动发现的 test 文件、107 项测试，全部通过**：

| 文件组（均以 `v2-` 开头）                                                                   | 现有覆盖                                                                      |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `battle-integration`                                                                        | 本地完整对战、状态、投降；依赖固定 sleep，只断言结束及有伤害，没有 golden     |
| `rng-regression`、`runtime-snapshot`                                                        | RNG 状态恢复、同种子摘要、不同种子、快照恢复                                  |
| `effects-core-regression`、`effects-marks-regression`                                       | 官方技能效果、状态变化、免疫、天气、属性阶段、治疗                            |
| `multihit-regression`、`skill-defeat-bookkeeping`、`stack-consumption-regression`           | 多段、OnMiss 击杀记账、自动/显式/护盾层数消耗                                 |
| `stat-stage-regression`、`message-bridge-switch-prompt`、`timer`                            | 能力变化、阶段事务中的即时换宠提示、计时器                                    |
| `data-loader`、`dsl-registry`、`operator-registry`、`selector-regression`、`strict-runtime` | YAML 解析与引用校验、DSL 注册与解释、严格类型运行时                           |
| `skill-mark-coverage.contract`                                                              | 已登记技能/印记覆盖清单；默认不要求所有官方内容有专项样例，严格模式可单独启用 |

同目录 `v2-smoke.ts`、`v2-e2e-yaml.ts` 是手动脚本，未被 `vitest.config.ts` 的 `**/*.test.ts` 收集，不计入 107 项。

CLI 本地入口是 `bin/cli.ts` 的 `local` 命令：`createLocalBattleFromYAML` → `LocalBattleSystemV2` → `BattleOrchestrator`，通过 TurnAction / ForcedSwitch / FaintSwitch 消息提交动作。现有 CLI 没有提供种子参数。此轮以相同 factory、orchestrator、selection/decision 和 phase 路径运行 headless 测试，直接 await orchestrator 完成；没有新增 CLI 或控制台交互功能。既有 LocalBattleSystemV2 集成测试继续执行。

## 新增完整战斗

输入与输出位于 `packages/battle/src/v2/__tests__/fixtures/baseline/`：

- `official-switch.input.json`：固定种子 `ae4-official-switch-201`、完整队伍配置，以及两侧各 8 次显式决策，含决策阶段。没有“选择第一个技能”的隐式 fallback。
- `official-switch.golden.json`：完整动作、有序引擎事件、触发器调用顺序、初始/每回合/换宠阶段检查点、最终状态。
- `helpers/golden-battle.ts`：从本地官方包建立真实 V2 战斗，检查动作是否可选，拒绝脚本耗尽、残余动作及失败阶段，最后清理观察器和 spy。引擎的阶段观察器会吞掉观察器异常，因此测试收集失败并在决策入口及结束时显式断言。
- `v2-golden-battle.test.ts`：每次执行创建两个独立 world，同种子重复完整战斗，要求结果完全相等，再与提交的 golden 对照。

队伍使用官方幻璃、迪兰，覆盖浑浊水域、气力、拍打、水泡。为缩短样例，显式覆盖 HP 上限：A 为 310/300，B 为 30/30；这是一组机制验收配置，不代表合法排位配队或数值平衡。未替换官方技能、效果定义或 DSL。

流程与断言：

1. A 使用浑浊水域，触发 OnHit → 加印记；印记从 5 回合逐步到期并清理。
2. 气力提升攻击等级；拍打/水泡覆盖物理/特殊伤害、暴击、怒气消耗、命中及回合获得怒气。
3. 第 3 回合 A 主动换宠，怒气 25 → 20。B 当回合使用对自身的气力，避免把已知旧目标攻击缺陷混入该场景。
4. 第 5 回合 B 首发阵亡；B 强制换上后备，A 在击杀奖励选择中明确 do-nothing；B 换宠怒气 100 → 80。
5. 第 7 回合 B 两只精灵全部阵亡，A 胜，原因 `all_pet_fainted`。A 两只精灵剩余 HP 272/264。

归一化只去除事件时间戳，并将随机实例 ID 替换为输入中的玩家/精灵/技能/印记标识。保留事件顺序、回合号和其余全部 payload 字段；不排序事件、不四舍五入伤害、不删除技能失败事件。检查点保留所有精灵（含下场与阵亡者）的 HP、存活、属性等级、印记层数/持续时间/激活状态，以及玩家怒气和当前精灵。

触发器 spy 转调原始 `EffectPipeline.fire`，不会替代结算逻辑。顺序日志证明调用路径；效果是否生效还由印记、等级、伤害和状态断言共同检查。记录的是引擎事件，不是 MessageBridge UI 消息格式或每条 stateDelta 的兼容承诺。

## V1 规范与 V2 缺陷差异

以下比较基于 V1 历史源码与当前 V2 的可执行样例。没有执行历史 V1 构建，也没有尚不存在的新 Core 结果；这是新 Core 的验收输入和已确认修复清单，不是“三个实现已经等价”的结论。

| 编号      | V1 预期                                        | 当前 V2                                        | 验收方式                                                                         |
| --------- | ---------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------- |
| V2-201-01 | 换宠后的怒气是 `floor(rage * 0.8)`             | 扣除 `floor(rage * 0.2)`，21 → 17，正确应为 16 | 独立 `test.fails`，只对最终数值作预期失败断言；主场景使用整除值 25/100，避开偏差 |
| V2-201-02 | 换宠后，攻击在执行时刷新目标，命中新上场的精灵 | 排序前锁定 actualTargetId，继续伤害已下场精灵  | 独立 `test.fails`；主场景在主动换宠时让对方使用自身技能                          |
| V2-201-03 | TurnEnd 后、换宠前，双方玩家都获得回合怒气     | active pet 阵亡时跳过回合怒气                  | 独立 `test.fails`，保留后备存活的队伍，20 正确应增长至 35                        |

源码依据：

- [V1 switch.ts](https://github.com/arcadia-eternity/arcadia-eternity/blob/c086289812885e7a4903b181e2b8989e201452b8/packages/battle/src/phase/switch.ts)：`settingRage(Math.floor(currentRage * 0.8))`。
- [V1 skill.ts](https://github.com/arcadia-eternity/arcadia-eternity/blob/c086289812885e7a4903b181e2b8989e201452b8/packages/battle/src/phase/skill.ts)：执行检查前 `context.updateActualTarget()`。
- [V1 turn.ts](https://github.com/arcadia-eternity/arcadia-eternity/blob/c086289812885e7a4903b181e2b8989e201452b8/packages/battle/src/phase/turn.ts) 的 `addTurnRage`、[V1 rage.ts](https://github.com/arcadia-eternity/arcadia-eternity/blob/c086289812885e7a4903b181e2b8989e201452b8/packages/battle/src/phase/rage.ts)：双方获得怒气；没有阵亡过滤。
- V2 对应文件：`phases/switch.handler.ts`、`phases/turn.handler.ts`、`phases/skill.handler.ts`。

**Golden 中仍记录 V2-201-03 的缺失怒气事件**，属于已知缺陷观测：本场 B 怒气已达上限，缺失不会改变最终数值，但事件/触发器顺序仍与 V1 有差异。未来补回事件及触发器时必须更新 golden，并将第 03 项转为普通通过测试。不要用当前日志缺少事件作为新 Core 的要求。

`test.fails` 的准备步骤在 beforeAll 中完成，加载错误、阶段错误、未实际换宠或没有实际伤害都正常报错，不能被误计为“已知缺陷”。本轮没有修复这些生产代码。

## 验证记录（2026-10-16）

- 修改前 battle：17 文件，107 项普通测试通过。
- 修改后 battle：19 文件，108 项普通测试通过，3 项明确预期失败（共 111 项）；无意外失败。
- battle 与 pack-loader 依赖图构建通过；新增测试及其导入源码 typecheck 通过；全仓 ESLint 与新增测试的独立 ESLint 均通过。
- 根 `pnpm typecheck` 未通过：仅构建 battle 依赖图时，另有 p2p-transport dist 缺失；旧服务代码还有 `window` 类型、装饰器、ioredis-mock 声明和 `src/domain/session/sessionStateManager` 解析错误。它们已在新增文件前复现；本轮未声称全仓 typecheck 干净，也没有为消除它们修改旧服务。
- `typecheck:battle-baseline` 单独纳入新测试及其导入源码，因为 battle 原 tsconfig 排除了全部 `__tests__`。CI 使用这项严格检查；`skipLibCheck` 只跳过外部声明文件检查。

- Golden 敏感性验证：将一个预期伤害值改动 1 点，测试按预期在 snapshot 比较处失败；恢复后重新通过。
- 根 ESLint 默认忽略 `__tests__`，新增 `lint:battle-baseline` 显式启用原规则和独立测试 tsconfig，避免“lint 通过”实际上没有检查新增测试。

## 尚未覆盖与下一轮

- golden 尚未覆盖所有官方精灵/技能/印记、所有触发器、护盾/多段完整战斗、印记继承/转移、双倒与连锁击杀、队伍预选、强制技能换宠、复杂属性克制。部分机制仅有现成的专项回归。
- 没有新增 MessageBridge 序列/stateDelta golden；CLI 参数解析与控制台交互、浏览器/Electron、服务器重连和计时行为不属于本轮新增验收。
- 覆盖清单并不证明所有官方内容等价；没有开启要求所有条目都有专项测试的 strict coverage 模式。
- 下一轮按 #202/#203 建立 `Battle / Player / Pet / Skill / Mark / Phase` 领域 API，以本轮动作、状态、事件作为输入输出契约，并优先按 V1 规范消除上面三处偏差。触发器和引擎事件格式可通过测试适配层转换，不要求保留通用 ECS。
- #204 的 RNG/快照/重放、#205/#223 的可信 TypeScript Effect/EffectTemplate、#207 的离线 CLI 应分别验收。此轮没有提前实现或关闭这些任务。
