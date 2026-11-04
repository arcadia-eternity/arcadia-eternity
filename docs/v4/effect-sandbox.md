# TypeScript 效果的 Arena / Comlink 执行宿主

此实现接续 [#218](https://github.com/arcadia-eternity/arcadia-eternity/issues/218) 和 [#269](https://github.com/arcadia-eternity/arcadia-eternity/issues/269) 的实验。对局使用独立 Worker，每个内容包在该 Worker 中拥有独立 QuickJS Runtime、Context、WASM 内存和 Arena。Worker 不复用，模块可变状态不跨局共享。

## 分工与入口

- `@arcadia-eternity/battle/v4/sandbox`：Arena 效果模块、Worker 管理器及 TypeScript 合同。
- `@arcadia-eternity/battle/v4/sandbox/node`：Node Worker 工厂；浏览器使用静态 `sandbox/worker` 入口，由 Vite 打包。
- `quickjs-emscripten-sync` 的 Arena 负责 VM 内外转换、代理及句柄；Comlink 负责主线程与 Worker 的异步调用和事件。没有自定义 RPC 协议、通用对象编码器或 Map/Set 同步实现。
- 原生引擎和 SDK 在 Worker 内执行。作者模块顶层、`createEffects`、`build`、自定义计算及回调在其包的 VM 内执行；同一个引擎调用栈中的 SDK 调用与回调同步重入。

`compileEffectModule` 使用固定 Rolldown 配置将 TypeScript 和依赖编译为封闭 ESM 文本，不执行作者顶层代码，不读取作者插件配置。依赖真实路径必须位于捕获的安装目录内；Node 内建模块、远程依赖和残留运行时 import 被拒绝。SDK 导入替换为宿主能力入口，避免打包出另一份引擎。

`prepareNpmProject` 的目录校验使用 Arena，并返回深冻结的 `sandbox` 配方。实际对战从配方在新 Worker 中重新创建目录和全部 VM。校验用目录不得作为多局共享的游戏运行时。官方基础包额外构建 `@arcadia-eternity/data-pack-base/sandbox`，提供相同效果源码编译得到的制品。

## 必要的 SDK 适配

`ArenaEffectSdk` 只处理本项目的 SDK 能力与身份：

- 注册 SDK 创建的参数、选择器、计划和效果导出，保留原生身份，使既有 WeakMap 注册和参数地址继续有效。
- 对领域对象提供实时只读字段；同一精灵或印记在多次调用中对应同一对象。状态变更使用 SDK 操作，或明确列出的领域方法（治疗、伤害、怒气、印记操作及本局 RNG）；不暴露调度器、进程对象或私有成员。
- 调用上下文、frame 和其操作只在当前同步回调内有效。回调结束注销临时注册，之后读取或调用会锁存故障；领域身份保留到该局销毁。
- 自定义回调必须同步，不接受 Promise。模块没有 Node、DOM 或网络能力；默认时间固定为零，`Math.random` 拒绝调用，随机结果从本局 RNG 取得。
- Map/Set 沿用 Arena 的值传递语义；内容目录的成员集合在本局固定，不提供通用集合变更同步。

原生 SDK 的全部基础设施 API 并非沙箱能力。直接构造领域实例、写领域字段、低层属性系统或自定义订阅应改用已有选择器、`ops`、参数和绑定工具；未适配的访问会失败，不会返回裸宿主对象。领域方法和公开字段的允许列表集中在 `sdk.ts`。

## 管理与故障

`BattleWorkerManager` 负责准入、启动、外部看门狗、取消、清理及有界状态记录。默认最多 4 局（含准备中），启动期限 20 秒，单次控制调用 5 秒，清理 1 秒，每秒健康检查。完成等待不受单次调用期限限制；健康检查仍继续。槽位在 Worker 实际终止后才释放。

VM 默认堆上限 128 MiB、WASM 上限 256 MiB、栈 512 KiB；初始化或工厂调用 10 秒、普通同步调用 500 ms，并限制调用次数、保留对象、包数、代码和输出大小。每个根调用共享重入期限和计数；还会执行并限制脱离调用的微任务。具体常量以 `contracts.ts` 为准。VM 内存限额不等于整个 Worker 或进程的 RSS 上限。

VM 故障锁存在模块；原生 execution budget 观察模块健康，阻止引擎在吞掉作者异常后继续结算。管理器遇到故障、Worker 退出或超时后终止该局，拒绝挂起调用。没有原生重跑、回滚、自动判胜或 Worker 复用。清理诊断区分正常释放与超时／异常后强制终止。

事件保留原生订阅的视角与隐藏信息规则，队列和单条消息有上限。输入事件在控制调用返回前送达，供 CLI 记录动作。管理器共享的仅是控制和诊断信息。

## 产品接入与持久化范围

浏览器本地对战与 P2P 主机、作者调试试玩、npm 内容包 CLI 对战及社区服务器的 npm 环境使用该 Worker 宿主。可信官方 CLI／服务端运行保留原生参考路径；沙箱失败不转入该路径。官方服务的第三方代码准入策略保持原有边界。

开发工具的 `testing.createBattle` 仅保留为可信进程内引擎检查工具，复用校验目录，供既有测试直接检查原生对象；不提供局间隔离和外部看门狗。产品对局和自动调试均使用 `createBattleSession`。作者测试本身是用户授权执行的 Node 程序，不能视为不可信游戏代码的入口。

默认官方内容允许已有等待点快照，恢复会在新 Worker 中重建目录、VM 和原生状态。任意 UGC 模块尚未提供闭包状态重建合同，因此其快照与 replay 明确拒绝；不会把函数、VM 堆或任意模块变量写入快照。调用方只能为已验证可重建的环境设置 `supportsSnapshots`。

## 验证与剩余边界

自动化覆盖真实 SDK 身份／参数、自定义同步计算、最新状态读取、原生治疗和 RNG、过期上下文、捕获异常后的故障锁存、无限循环及微任务、编译路径与 import 拒绝、跨包／跨局隔离、取消和并发限制。官方完整效果目录在真实 Node Worker 中运行，与原生固定输入驱动逐等待点比较；另测新 Worker 中恢复官方等待点后继续执行。

2026-11-04 验证：各包整包回归合计 1601 项通过，服务端另有 14 项跳过。其中引擎 679、加载器 65、CLI 60、作者工具 101、Web 541、服务端 116；其余为 schema、client 和 P2P transport。浏览器本地启动、队伍预选和延迟资源启动 3 项通过。新增压缩 Worker 回归实际执行 `ParameterCatalog`、`HealContext`、`Pet instanceof` 和治疗事件；内容修改后拒绝旧快照的回归通过。官方差分比较本例逐等待点的回合、阶段、状态、HP、怒气和印记，不代表全量事件轨迹验收。

这些测试不替代 #269 的完整安全验收。全部历史差分样本、长期 RSS／句柄压力、恶意依赖完整矩阵、平台级进程故障隔离、正式安装包及跨平台运行仍需单独验证。Worker 可以隔离普通 JS 执行和可终止的故障；整个进程的致命故障仍需要部署层进程边界。
