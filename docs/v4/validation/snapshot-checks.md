# V1 Snapshot 验收记录

2026-10-17，基线 `0d66dbe6`。真实 V1 的普通选招等待点快照/恢复，详细边界见 [协议与状态清单](../v1-snapshots.md)。新增实现为 `e110e897` 及其后续审查修复，保留既有原码来源映射和 #201 回归。

| 检查                              | 结果                                                                                | 证据                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 完整 V1 测试                      | 9 文件、69 项普通通过，含10项快照专项；没有 expected failure                        | [V1](./snapshot-v1-tests.log)                                                                                   |
| #201 / V2 原样回归                | 19 文件、108通过 +3既有预期失败；未改源码/fixture/预期                              | [V2](./snapshot-v2-baseline.log)                                                                                |
| `pnpm build`                      | 整仓 lint、全部包构建、根类型检查、CLI bundle 通过                                  | [build](./snapshot-full-build.log)                                                                              |
| V4 和 #201 类型与 lint            | 全部通过；新快照代码无历史源码风格豁免                                              | [检查](./snapshot-typecheck-lint.log)                                                                           |
| 来源与闭包                        | 42核心/87映射；42文件原样、45有记录修改；没有 RxJS/Prando 运行依赖                  | [provenance](./snapshot-source-check.json)                                                                      |
| Node / 压缩 Browser / 真实 Chrome | 完整真实战斗、动态 DSL 与快照续战一致；双向交换 JSON，Chrome恢复 Node快照；各39模块 | [宿主](./snapshot-node-browser.log)、[状态](./snapshot-node-result.json)、[模块图](./snapshot-host-graphs.json) |
| 新进程恢复                        | 原进程输出JSON，新 Node进程读入后重建对象，续接原真实 Battle到4回合 A胜             | [结果](./snapshot-isolated-result.json)                                                                         |
| 两轴代码审查                      | 两项P2已修复并独立复查通过                                                          | [审查](./snapshot-review.md)、[红](./snapshot-review-red.log)、[绿](./snapshot-review-green.log)                |

最后的完整69项已包括审查修复与后补的 timer/phase-bound 非法恢复拒绝测试。审查绿日志是在追加该第10项之前运行，记录9项专项通过，不冒充最终全量结果。

## 实战断言

- 真实4回合2v2场景在第1回合完成、A已选择换宠时保存，包含B印记和accuracy=90；恢复后最终伤害 `[13,383,398]`、HP `[246,247,0,0]`、第4回合A胜。Node、Chrome、新进程均实际续战，没有从头重打。
- 原历史 YAML / #201 队伍在第二回合后保存，保留气力能力等级、天气等实际状态。恢复后继续剩余显式动作，比较剩余事件类型顺序和伤害，检查第7回合A胜、HP `[283,284,0,0]` 和双方怒气100。事件实例ID不在本轮逐字等价合同内。
- 动态属性/DSL、能力等级倍率、scoped配置、变身原生来源与suppression、跨目标修饰器清理、clamp、第二代快照、AI随机续接、部分输入取消/投降均有回归。
- 未注册动态值/函数、缺工厂、非法recipe、不同catalog、非法引用、重复活跃Battle、阶段绑定和实时timer均明确拒绝。失败恢复检查不破坏源Battle和Attribute全局注册计数。

## 范围与限制

P2P按用户要求跳过。未重复扩展到联机Server测试；上一里程碑的两项Server断线断言失败仍见 [原记录](./modernization-checks.md)，本轮未改Server或默认V2源码，不能声称仓库所有tests都通过。

本轮不是完整 #204：不支持任意执行阶段/强制换宠等待/实时计时器恢复，不恢复已完成阶段诊断历史，不迁移任意闭包/跨版本内容，不提供持久ActionLog replay。规范内容不可变、revision正确且工厂纯度由宿主保证；未逐项验证全部官方效果。#202、#203、#204继续开放。
