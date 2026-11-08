# 原生宿主接入

## 构造与内容身份

内容加载示例见[内容结构](content-structure.md)。`NativePackLoader` 接收可信构建身份与内容工厂，传输层处理文件/HTTP、manifest、资源与 lockfile；元数据中的 Effect ID 连接编译后的 TS。缺失引用会在发布目录前失败。

原生 revision 包含可信代码构建身份、按序的包身份和元数据。元数据的表示及顺序变化也会改变 revision；资源 URL、locale 展示和图片不改变可执行内容身份。可通过 `revision` 指定环境标识，加载器不再将它作为内容校验和比较。构建身份由可信本地构建提供。

```ts
import { LocalBattleSystem } from '@arcadia-eternity/battle/host'

const { content } = await loader.load('builtin:base')
const [a, b] = content.parsePlayers([teamA, teamB], { aiPlayerIds: ['playerB'] })
const battle = content.createBattle(a, b, { rngSeed: 201 })
const system = new LocalBattleSystem(battle, content)
const unsubscribe = system.BattleEvent(onMessage, { viewerId: a.id })
await system.ready()
await system.submitAction(selection)
```

`LocalBattleSystem` 实现现有 `IBattleSystem`，规则、视图、计时与动画仍交给 Battle。`ready()` 在输入等待和决策计时就绪后返回，并发调用共享首次准备；`submitAction()` 等待前一轮结算后接受下一动作。异步错误通过 `waitForCompletion()` 及后续宿主调用报告。结束后输入被拒绝；`cleanup()` 幂等地取消等待并释放资源。

每次消息/计时订阅独立可移除。浏览器协议中的状态计数器及 delta 由宿主适配，核心快照保留核心计数语义。投降通过 Battle 的已有结束路径结算，无需对方提交选择。

## 各宿主入口

| 宿主             | 入口与约定                                                                                                                              | 主要检查                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 服务端           | 单进程服务器创建原生 对战                                                                                                               | `pnpm test:server`、`pnpm typecheck:server`、`pnpm lint:server`                           |
| 本地与非 UGC P2P | `packages/web-ui/src/services/nativeBattleFactory.ts` 捕获本次启动的元数据；旧草稿试战使用独立快照，非 UGC P2P 等待异步构造完成后初始化 | `pnpm test:web-native`、`pnpm typecheck:web`、`pnpm lint:web`、`pnpm test:web-native:e2e` |
| CLI 本地         | `bin/native-local-battle.ts` 加载原生内容并通过现有控制台接口运行；输入仍为 YAML/JSON 队伍草稿                                          | `pnpm test:cli-native`、`pnpm build:cli`                                                  |

各入口每场分配新的精灵/技能实例，保留队伍元数据与显式 HP。AI 使用已有 `AIPlayer`，通过 `Battle.setSelection` 提交动作，参与日志、等待通知与计时。队伍草稿即使来自同一文件，也不复用战斗实例身份。

## 队伍预选

宿主构造选项可启用队伍预选。双方名单先完整验证，再修改阵容；选中的精灵与技能保留实例身份。FULL_TEAM、TEAM_SELECTION、VIEW_ONLY 沿用已有协议，双方确认后只启动一次。预选计时保留总预算，进入战斗时重置普通回合限时；超时选择合法默认阵容。投降、总时间耗尽与 cleanup 终止预选。

预选过程通过原生宿主快照保存双方选择/确认状态及原计时期限；恢复不重发预选开始或清空已确认选择。预选结束后的正常等待点恢复所选阵容，不重开预选。浏览器预选输入复制 pet-ID 数组，避免保留 Vue 代理或调用方可变引用。

## 在线重连与恢复边界

当前单进程服务器在内存中持有房间和战斗。页面刷新与短时断线可凭有效会话重连仍存活的进程；停机、崩溃、升级会结束房间。服务端不写 Redis 检查点或在线动作日志，也不从初始快照自动重放恢复，详见[服务端运行时](server-runtime.md)。

核心与本地宿主的快照仍支持[列出的等待点](snapshots.md)，恢复时使用所选内容目录和绑定工厂。CLI 使用自己的[离线 replay 合同](cli.md)。持久检查点与跨进程在线恢复继续由 #224／#244 跟踪。

## 验收范围

库的 Node/Chrome HTTP 探针使用 `pnpm verify:battle-native-pack`，覆盖完整动作脚本、新目录恢复、AI、计时/动画与重连期限，并拒绝效果 DSL 请求。浏览器页面与真实私房服务分别验收：私房流程需要实际单进程服务和双客户端；完整网络异常与结束后再开局矩阵继续归 #211。UGC 对战由服务器执行，网页不安装或执行 npm 内容包。
