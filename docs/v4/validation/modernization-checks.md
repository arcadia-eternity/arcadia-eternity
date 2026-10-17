# 本轮验证记录

基于已跑通原版的 `14125996`，2026-10-16。所有测试使用真实移植类；专项 phase 测试复用原 PhaseManager，完整场景走真实 startBattle。

## 失败到修复

以下是修复前已执行的命令与日志；日志中的预期失败属于复现证据，不是最终状态。

| 命令（均在 battle package 用 `vitest run --config vitest.v4.config.mjs`）      | 失败证据                                                                                                    | 最终覆盖                              |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `test/v4/known-defects.test.ts test/v4/historical-fixes.test.ts`               | [上下文/印记/治疗](./fixes-red.log)；其中最早 HP 用例曾因 fixture ID 不合 schema 失败，不能作为 HP 缺陷证据 | 同路径普通通过；HP 另以下一行复现为准 |
| 以 HEAD 原实现暂时替换 Pet/Parser/变身策略并运行对应 `-t` 用例，随后还原并重建 | [有效 HP 与 native Override 复现](./hp-native-red.log)                                                      | historical-fixes 与 phase-lifecycle   |
| `test/v4/phase-lifecycle.test.ts`                                              | [阶段与变身 HP](./phase-red.log)                                                                            | 同文件                                |
| `test/v4/execution-lifecycle.test.ts`                                          | [等待取消/投降/优先级/重复变身](./execution-red.log)                                                        | 同文件                                |
| 对 sureCrit/重试用例执行 `-t`                                                  | [技能配置/不安全重试](./last-defects-red.log)                                                               | historical-fixes 与 phase-lifecycle   |
| 扩展 phase-lifecycle 后运行该文件                                              | [配置来源抑制与立即通知](./suppression-red.log)                                                             | 同文件                                |
| 再加入注入 ConfigSystem 用例运行该文件                                         | [自定义配置回归](./injected-config-red.log)                                                                 | 同文件                                |

最终 [V1 测试](./v1-tests.log)：8 文件、58 普通通过，无 expected failure。新增 reactive 测试验证动态分支/菱形依赖、动态 DSL、clamp、批量清理和失败订阅；RNG 测试包含固定算法向量、JSON 续接、种子与范围校验。未穷尽所有历史效果。

## 最终命令

- `pnpm build`：通过，包含根 lint/types、全部 package build、CLI bundle。
- `pnpm test:battle-baseline`：通过，108 + 3 原有 expected failure；未改 #201。
- `pnpm test:battle-v4`：通过，58。
- `pnpm typecheck:battle-v4`、`pnpm typecheck:battle-baseline`、`pnpm lint:battle-v4`：全部退出 0。
- `pnpm verify:battle-v4-source`：通过，87/87 映射及内部 import 闭包。
- `pnpm verify:battle-v4-hosts`：通过，真实 Chrome 输出与 Node 完整一致；原 Qili DSL、动态值清理和 RNG JSON 续接；两个模块图均无 RxJS/Prando。
- `pnpm battle:v4-demo`：原版 YAML/DSL 完整 7 回合 A 胜，16 个动作。

最早并行运行多套全量数据加载时出现超时，已串行复验而没有修改超时阈值；V1 最终运行 28.67 秒、V2 24.85 秒。整体耗时不是性能基准，不能据此比较算法性能。

P2P 按用户要求跳过。扩展命令 `pnpm -r --filter './packages/**' --filter '!@arcadia-eternity/p2p-transport' --filter '!@arcadia-eternity/battle' --if-present run test:run --maxWorkers=2` 在 Server 失败；Server 单独串行再跑 `pnpm --filter @arcadia-eternity/server run test:run --maxWorkers=2` 后剩 2 断线行为断言失败，104 通过。源码与默认运行依赖相对 #201 的 diff 为空，未把它描述成 V1 回归通过或全仓测试通过；不扩展到联机 Server 修复。

生成的 `v1-compatibility.patch` 中空白上下文行按 unified diff 格式保留；源码/文档 diff whitespace 检查排除该生成产物后通过。为保留历史源码对照，提交不对旧文件整体重新格式化；提交前实际执行了上述 lint/types/build 检查。
