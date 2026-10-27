# V2 → V1 战斗回归基线

此文是历史记录。V2 实现和专属测试已从 V4 移除；V4 仍用到的对战输入位于 `packages/battle/test/fixtures/official-switch.input.json`。原始测试及 golden 可在历史提交 `989d10f1` 中查阅。

V1 行为是验收规范。V2 golden 保存现有实现的可复现观测；与 V1 冲突的部分按缺陷处理，不能通过刷新 golden 改写规范。

## 运行与更新

先构建 workspace 依赖，再执行：

```sh
pnpm test:battle-baseline
pnpm typecheck:battle-baseline
pnpm lint:battle-baseline
```

仅运行完整战斗及已知差异：

```sh
pnpm --filter @arcadia-eternity/battle run test:run v2-golden-battle.test.ts v2-baseline-known-defects.test.ts --maxWorkers=2
```

经审查确认行为变化后，可使用 Vitest 的 `-u` 更新 golden。更新时一并检查事件、触发器、状态与已知缺陷断言。

## 测试合同

历史 V2 测试的 `official-switch.input.json` 固定种子、队伍及两侧显式动作，`official-switch.golden.json` 保存动作、有序事件、触发器顺序、阶段检查点与最终状态。原测试构造真实战斗并拒绝无效动作、脚本耗尽、残余动作和失败阶段；每次测试创建两个独立 world，先验证重复运行一致，再比较 golden。

归一化只替换随机实例 ID 并去掉事件时间戳；保留顺序、payload、精确伤害及所有队员状态。检查点覆盖主动/强制换宠、印记生命周期、怒气、能力等级与胜负。队伍中的 HP 覆盖用于机制验收。golden 记录引擎事件；UI 消息和 stateDelta 由宿主测试维护。

## 已知 V2 差异

| 编号      | V1 规范                          | V2 观测                                      |
| --------- | -------------------------------- | -------------------------------------------- |
| V2-201-01 | 换宠后怒气为 `floor(rage * 0.8)` | 扣除 `floor(rage * 0.2)`，21 得到 17 而非 16 |
| V2-201-02 | 技能执行时刷新目标               | 排序前锁定目标，换宠后仍可能攻击已下场精灵   |
| V2-201-03 | TurnEnd 后双方都获得回合怒气     | 当前出战精灵阵亡时跳过                       |

独立 `test.fails` 保留这些差异；准备、阶段和真实执行检查在预期失败断言之外。主 golden 使用整除怒气值，并在主动换宠时安排对方使用自身技能以避开前两项。第三项的缺失事件仍保留在 golden 中：修复时应补回事件/触发器并将对应测试改为普通断言。

V1 依据可从初始来源提交的 `phase/switch.ts`、`phase/skill.ts`、`phase/turn.ts` 与 `phase/rage.ts` 查询，来源见 [V4 指南](direct-v1-port.md)。完整官方内容、宿主恢复与 UI 消息需要各自的测试。
