# 原生宿主接入

## 构造与内容身份

内容加载示例见[内容结构](content-structure.md)。`NativePackLoader` 接收可信构建身份与内容工厂，传输层处理文件/HTTP、manifest、资源与 lockfile；元数据中的 Effect ID 连接编译后的 TS。原生加载不读取旧效果 DSL，缺失引用或不匹配 revision 会在发布目录前失败。

原生 revision 包含可信代码构建身份、按序的包身份和元数据。元数据的表示及顺序变化也会改变 revision；资源 URL、locale 展示和图片不改变可执行内容身份。`expectedRevision` 可用于固定恢复版本。构建身份由可信本地构建提供。

```ts
import { LocalBattleSystemV4 } from '@arcadia-eternity/battle/v4/host'

const { content } = await loader.load('builtin:base')
const [a, b] = content.parsePlayers([teamA, teamB], { aiPlayerIds: ['playerB'] })
const battle = content.createBattle(a, b, { rngSeed: 201 })
const system = new LocalBattleSystemV4(battle, content)
const unsubscribe = system.BattleEvent(onMessage, { viewerId: a.id })
await system.ready()
await system.submitAction(selection)
```

`LocalBattleSystemV4` 实现现有 `IBattleSystem`，规则、视图、计时与动画仍交给 Battle。`ready()` 在输入等待和决策计时就绪后返回，并发调用共享首次准备；`submitAction()` 等待前一轮结算后接受下一动作。异步错误通过 `waitForCompletion()` 及后续宿主调用报告。结束后输入被拒绝；`cleanup()` 幂等地取消等待并释放资源。

每次消息/计时订阅独立可移除。浏览器协议中的状态计数器及 delta 由宿主适配，核心快照保留核心计数语义。投降通过 Battle 的已有结束路径结算，无需对方提交选择。

## 各宿主入口

| 宿主             | 入口与约定                                                                                                                            | 主要检查                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 服务端           | `packages/server/src/domain/battle/runtime/localBattleRuntimeFactory.ts` 默认创建 `native-v4`，旧 V2 入口待移除，不再承诺历史恢复兼容 | `pnpm test:server-native`、`pnpm typecheck:server-native`、`pnpm lint:server-native`                    |
| 浏览器本地与 P2P | `packages/web-ui/src/services/nativeBattleFactory.ts` 捕获当前元数据，含未保存编辑；P2P 等待异步构造完成后初始化                      | `pnpm test:web-native`、`pnpm typecheck:web-native`、`pnpm lint:web-native`、`pnpm test:web-native:e2e` |
| CLI 本地         | `bin/native-local-battle.ts` 加载原生内容并通过现有控制台接口运行；输入仍为 YAML/JSON 队伍草稿                                        | `pnpm test:cli-native`、`pnpm build:cli`                                                                |

各入口每场分配新的精灵/技能实例，保留队伍元数据与显式 HP。AI 使用已有 `AIPlayer`，通过 `Battle.setSelection` 提交动作，参与日志、等待通知与计时。队伍草稿即使来自同一文件，也不复用战斗实例身份。

## 队伍预选

宿主构造选项可启用队伍预选。双方名单先完整验证，再修改阵容；选中的精灵与技能保留实例身份。FULL_TEAM、TEAM_SELECTION、VIEW_ONLY 沿用已有协议，双方确认后只启动一次。预选计时保留总预算，进入战斗时重置普通回合限时；超时选择合法默认阵容。投降、总时间耗尽与 cleanup 终止预选。

预选过程通过原生宿主快照保存双方选择/确认状态及原计时期限；恢复不重发预选开始或清空已确认选择。预选结束后的正常等待点恢复所选阵容，不重开预选。浏览器预选输入复制 pet-ID 数组，避免保留 Vue 代理或调用方可变引用。

## 服务端恢复

创建原生对战后，在发布本地实例前，先将完整初始快照、runtime kind、可信构建身份及内容 revision 保存到 Redis/房间元数据，至少一处成功。只保存队伍草稿会重建不同实例 ID，无法重放引用旧技能 ID 的动作日志。

恢复先按持久身份选择实现：旧 V2 对局不在本次迁移的恢复兼容范围内；现存历史分派代码留待 V2 整体清理。损坏的原生描述明确失败。原生恢复校验构建与内容身份，优先使用不超前于日志及未完成阶段基线的兼容检查点；无法使用时回到同一原生初始快照再重放已接受动作。恢复失败保留原 bootstrap 与日志。

激活房间前重新读取已保存记录，避免临时 waiting-room 数据覆盖 bootstrap。重连窗口恢复后保持原绝对期限；动作重放等待真实输入边界。详细快照边界见[快照指南](v1-snapshots.md)。

## 验收范围

库的 Node/Chrome HTTP 探针使用 `pnpm verify:battle-v4-native-pack`，覆盖完整动作脚本、新目录恢复、AI、计时/动画与重连期限，并拒绝效果 DSL 请求。浏览器页面与真实私房服务分别验收：完整私房流程需要可用的鉴权、存储和网络服务，内存传输与本地页面回归不代替该流程。
