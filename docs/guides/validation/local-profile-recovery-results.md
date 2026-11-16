# #212 实现与 #263 本机验证记录

日期：2026-11-13。被测代码为本文所在提交的工作区实现，基线 `22a0782df3963eb83d60a99d2e07ecb7794b7093`。环境为 macOS 26.7.2（25G320）、arm64、Node 24.19.0；使用源码构建的 CLI、Chromium 和 Electron 控制器测试，未使用安装版。此记录不关闭 #263。

## 交付内容

- `packages/local-profile` 定义严格的便携资料格式、摘要、预览/提交、单个恢复点和 revision 比较交换。IndexedDB 与文件存储共享资料服务。
- Web 的 `/profile` 提供导出、预览、恢复、失败重试和损坏旧记录导出；旧存储迁移不删除原键。设置保存进入统一队列。
- Electron 主进程持有资料目录的写入所有权；远程窗口只获得临时快照，保存需要主窗口确认，较新编辑和取消退出均保留草稿。
- CLI 提供 `profile init/show/set-name/export/inspect/import/recover/repair/unlock`；`battle local --use-profile --team` 使用本地昵称和队伍，战斗席位由引擎独立生成。
- 更换 UID 必须断开连接并取得共享资料切换锁；服务器拒绝带活动连接、房间或匹配的换 UID 请求。新席位与新 sessionId 保留服务器验证的账号归属，备份不包含凭据。

## 已执行的自动化

| 范围            | 命令 / 证据                                                                                                       | 结果与边界                                                                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 工作区构建      | `pnpm test` 的 `test:prepare`；后续 `pnpm --filter @arcadia-eternity/local-profile build`、`pnpm build:cli`       | 构建通过；并行构建曾短暂移除声明目录，改为先完成构建再检查                                                                                      |
| 全工作区类型    | `pnpm test:types`                                                                                                 | 通过，包含服务端、前端和 CLI 测试类型                                                                                                           |
| 静态检查        | `pnpm lint`                                                                                                       | 通过；knip 仅报告现有配置提示                                                                                                                   |
| 资料存储        | `pnpm --filter @arcadia-eternity/local-profile test:run`                                                          | 13 项通过：两种 adapter、重复导入、恢复点、过期预览、并发恢复、损坏修复、写失败、未知版本、凭据排除、活 owner、中断恢复门和无效编码原始字节保留 |
| CLI 新用例      | `pnpm --filter @arcadia-eternity/cli exec vitest run test/profile.test.ts test/profile-team.test.ts`              | 2 项：构建后的 CLI 跨进程往返、原文件保持、恢复/修复/输出不覆盖，以及选队与独立战斗 ID；资料命令子进程禁止网络连接                              |
| 浏览器          | `pnpm --filter @arcadia-eternity/web-ui exec playwright test e2e/profile-recovery.spec.ts e2e/account-g3.spec.ts` | 7 项通过：5 项资料用例和 2 项账号用例；资料用例阻断后端 API，页面壳由本地 Vite 提供                                                             |
| Electron 控制器 | `node --test packages/web-ui/electron/remote-play.test.mjs`                                                       | 4 项通过；假窗口验证隔离、来源校验、草稿保存竞争和取消退出，不等于真实安装版验证                                                                |
| 身份服务        | `test/profileChange.test.ts`、`test/sessionIdentity.test.ts`                                                      | 18 项通过；HTTP/Socket.IO 换 UID 边界与 SQLite 账号恢复，未运行 PostgreSQL                                                                      |
| 全仓其余套件    | `pnpm test`                                                                                                       | battle 655、client 19、schema 8、p2p 15、pack-loader 112、content-dev 164、CLI 66、web-ui 863 项通过；database 15 项通过、PostgreSQL 8 项跳过   |

服务器全套首次结果为 288 通过、3 失败、58 跳过。3 项失败均位于 `runtime.rooms.test.ts`，开局请求返回 `INVALID_REQUEST`。随后先单独重跑这 3 项，再重跑该文件全部 4 项，均通过，未更改断言或超时。失败发生时前端套件同时运行，但尚未定位内部错误根因，不能仅据复跑成功断言是负载问题。`pnpm test` 的首次运行仍记为失败；其余通过结果和文件级复跑结果分别保留，58 项条件跳过不计入通过。

## 与验收用例的对应关系

[验收方案](local-profile-recovery-plan.md)中的编号为完整目标；下表只描述本机已覆盖的部分。

- P01/P03、R01/R04/R09、M01：真实浏览器与构建后的 CLI；另覆盖首次写失败后 UID 不变、冲突身份显式选择、一份旧身份损坏时采用另一份、原文导出与凭据排除。
- P04/P05、R02–R05、R08/R10：存储服务自动化；失败前后比较完整资料和恢复点。R07 的真实进程终止与掉电边界未完成。
- E02–E04：控制器与来源校验的自动化部分；尚缺真实 Electron 窗口和安装包证据。
- C01/C02：CLI 子进程与选队入口验证；另以构建后的 `battle local --use-profile --team 1 --ai player1,player2 --max-turns 20` 完成一场真实本地对战（退出码 0、completed），结束后资料原文未变；夹具来自 `official-switch.input.json`，双方技能设为 `skill_paida`、maxHp 为 1，使用临时资料目录，运行后删除。跨 OS 待执行。
- I01/I02/I08：已有身份回归加新换 UID 路由；I05–I10 的完整多窗口、活动对局和故障注入矩阵仍需按方案执行。

## 尚未执行

Windows/Linux、Safari/Firefox、真实 Electron 安装版升级、两台设备九格互换、全部强制终止时点、完整多窗口换 UID 故障矩阵，以及 PostgreSQL 的原服恢复/克隆尚未执行。未测项保留为 not-run/skip，不由本机单元测试替代。测试使用临时目录、临时浏览器上下文和合成身份，不使用真实个人备份或账号凭据。
