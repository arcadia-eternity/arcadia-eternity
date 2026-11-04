# 统一管理、私人约战与在线备份验证（2026-11-05）

本记录对应 [PR #275](https://github.com/arcadia-eternity/arcadia-eternity/pull/275) 的未发行实现；当前远端结果对应 [bfefb852](https://github.com/arcadia-eternity/arcadia-eternity/commit/bfefb8521b8855cfa92919aac821f6ade1bef489)。测试由根任务和专项执行者运行，文档同步核对了源码、浏览器 acceptance JSON、网络摘要、Docker 记录与远端 job 状态。各测试快照、CI job、安装和生产验收分别记录。

## 当前本地回归

| 范围                          | 结果                           | 口径                                                                 |
| ----------------------------- | ------------------------------ | -------------------------------------------------------------------- |
| 服务端                        | 30 文件，320 项通过；127.44 秒 | 真实 SQLite/PostgreSQL，exit 0、无未处理异常；自有临时 PG 已停止     |
| Web 专项                      | 18 文件，257 项通过；14.56 秒  | 先前 3 项大厅 mock 参数断言失败已修复                                |
| 备份核心                      | 14/14 通过                     | 真实双库、逻辑迁移、在线捕获竞争及失败恢复                           |
| 工作区 / 私有桌面 IPC         | 20 / 13 项通过                 | 导入持久记录、快照 stamp、owner 与材料保护                           |
| lint / 类型 / production 构建 | 通过                           | 最新全仓 ESLint、根/服务端/Web 类型、Vite production 与 paired stage |
| 编译后 CLI 生命周期           | 3/3，21.45 秒                  | 首次初始化、5 次管理保留重启、旧库与 clone/restore 真启动            |
| 首次初始化 / binding          | 5/5 与 7/7                     | 包含 pending retention 与稳定首次使用关系                            |
| 普通匹配 / 权威好友房         | 2/2，约 1.3 分钟               | 真实浏览器生产 CLI 路径                                              |

最新全仓 ESLint、根/服务端类型、Web vue-tsc、Vite production 与 paired stage 构建通过；服务端入口一致性窄回归 5/5、2.92 秒通过。所有变更/新增 TS、Vue、mjs、yaml 的格式检查与 git diff 检查通过。资源相关 3 文件/76 项通过，管理页面缺省 progress.stage 的窄幅回归 8/8 通过；资源测试已纳入 baseline CI。此前 frozen/offline 锁文件与 native renderer/test 验证记录保留。

第二轮 [baseline CI](https://github.com/arcadia-eternity/arcadia-eternity/actions/runs/41889173170) 已结束：changes、headless-battle、offline-cli 和 management-browser-acceptance 通过，生产私人约战/管理备份执行及零跳过断言保持通过；native-server-entry 与 native-browser-entry 失败。

- 服务端 315 项断言通过，但备份 fixture 清理仍触发 2 个未处理 `57P01`，job 判失败。随后统一修补 8 处 fixture 并共用 `dropTestDatabase`；真实 PG 回归 **110 项通过、0 未处理错误**。随后完整服务端 30 文件/320 项以 exit 0、0 未处理异常通过；新远端结果仍待产生。
- 浏览器内容/连接 6 场景本地约 1.1 分钟通过，第二轮 CI 同步骤也通过；后续普通匹配/权威好友房暴露 production CLI 首次持久初始化没有默认 binding，返回 `ENVIRONMENT_NOT_PUBLISHED`。首次初始化/保留关系修补后，编译 CLI 生命周期 3/3、真实普通匹配/权威房间 2/2 已通过；新种子基线（初始环境 1、备份总环境 2）的管理页面也已真实通过，详见下方。
- 第二轮 [desktop-runtime-validation](https://github.com/arcadia-eternity/arcadia-eternity/actions/runs/41889173077) 四平台仍失败。Linux 和两种 macOS 已通过打包及包内 SQLite，完整宿主测试因 clean checkout 缺少示例 slow-effects 产物失败；fixture 已改为从空目录显式编译并核对归档，修正后的实际 macOS 包完整宿主 **1/1，13.95 秒**通过。Windows 已通过原构建路径问题，本轮转为 pnpm fixture 版本及测试路径失败；现已调整 PNPM_HOME 固定版本优先、fixture 的 packageManager 初始化和 native absolute 路径，三组定向回归 24/24 通过，目标平台远端重跑待完成。

首轮 [baseline](https://github.com/arcadia-eternity/arcadia-eternity/actions/runs/41886687367) / [桌面矩阵](https://github.com/arcadia-eternity/arcadia-eternity/actions/runs/41886687641) 保留作历史记录；第二轮已越过原 database/dist 与构建路径/metadata 问题。当前没有任何“新修补已通过整套 CI”的结论。

原 29 文件/315 项及窄幅清理后的真实 socket 7/7 是历史结果；当前服务端结论以 30 文件/320 项、exit 0 为准。Web 257 项仍对应此前快照；最新资源修补由 76 项专项和下方严格 production 复验覆盖。

测试实现包括 `bin/__tests__/server-backup.test.ts`、`packages/content-dev/test/content-workspace.test.mjs`、`packages/web-ui/electron/test/desktop-workspace.test.mjs` 及服务端/Web 对应测试目录。

## 真实 production 构建的管理页面

[management-backup.spec.ts](../../../packages/web-ui/e2e/management-backup.spec.ts) 最终 paired build 的新 builtin 基线 **1/1 通过，17.1 秒**。归档含 builtin 与新准备环境共 2 个环境/版本。使用实际 CLI、独立数据目录及构建后的配套网站，没有请求替身或页面 store 注入。

- 匿名备份请求被拒绝；宿主一次性登录码经页面兑换。
- 准备真实固定环境，签发服务凭证；明文不进入浏览器持久存储，刷新后仅显示安全元数据。
- 创建/手动下载在线备份，宿主离线检查确认身份和材料，归档排除活动凭证；通过元数据界面撤销服务凭证。
- 重启保留 serverId/workspaceId、环境列表、仍有效的凭证元数据、撤销结果和已完成备份下载历史。
- 浏览器错误和意外 HTTP 响应均为空。该场景使用 guest 账户模式；G3 真实提供商与账户数据保留分别由提供商/存储测试承担。

当前保留产物位于 `packages/web-ui/test-results/management-backup/2026-11-04T19-16-09-114Z/`，已读取 acceptance JSON 确认 passed、2 个环境/版本、无浏览器错误或意外响应；同目录包含截图及实际备份文件。为避免记录凭证，trace/video 关闭。早期本地产物曾被默认 outputDir 清理；当前配置已隔离输出目录，本文只将本次确认存在的路径作为附件。

## 私人 Challenge 双浏览器

[personal-environment.spec.ts](../../../packages/web-ui/e2e/personal-environment.spec.ts) 最终 paired build **1/1 通过，50.2 秒**。两个独立客户端显式导入未发布环境，首局和同房间再战均为 2 回合自然结算，两端胜负一致。

- 网络记录 `errors: []`，两端 UI 错误列表为空；实际 UGC 媒体解码通过。
- 292 次服务器采样的 Worker 最大值为 0，公开目录不变；609 个 WebSocket 帧通过仅引用、不传作者代码/归档的检查。
- 当前产物为 `packages/web-ui/test-results/personal-environment/2026-11-04T19-16-06-975Z/`，已读取 acceptance JSON 与 network-events.json；包含两局结果截图和 traces。

此前一轮虽自然结算，但 loading overlay 淡出时提前回收 Blob 导致 4 个 `ERR_FILE_NOT_FOUND`，严格断言正确判失败。资源生命周期修补先复现失败再通过对应 transition 回归，3 文件/76 项与本轮零浏览器错误结果验证了修复；没有放宽 console 断言。旧输出曾被默认 outputDir 清理，4 个配置现已隔离目录；旧成功只作为历史记录，不继续引用已删除附件。

两组 production 场景需先完成 CLI 与配套网站构建，可从仓库根目录运行：

```sh
PLAYWRIGHT_MANAGEMENT_BACKUP=1 pnpm --filter @arcadia-eternity/web-ui exec playwright test --config playwright.management-backup.config.ts
PLAYWRIGHT_PERSONAL_ENVIRONMENT=1 pnpm --filter @arcadia-eternity/web-ui exec playwright test --config playwright.personal-environment.config.ts
```

## Docker 与桌面证据范围

最终 Docker 证据为 `.omo/evidence/docker-management.json`：Linux arm64 镜像 `sha256:fcb6bcc5739ee951dd6668b6fdcf861943bfda6de99b55c67996e943b744f8b8`，Node 24.22.2、SQLite 3.53.2、PostgreSQL 17，验收 15.6 秒。两库均验证首次 builtin-server 默认绑定及 145 个物种；容器重建后 serverId/workspaceId、设置、默认绑定和版本保持，内容/资源修订一致，PG 另经数据库重启。测试容器、卷、网络均已清理。该镜像包含首次初始化、持久 retention 与最后 UI 修补，`pairedUiRefreshPending=false`。

sourceProof 记录 1,341 个输入保持一致，摘要 `sha256:33881fd68fc0dc90c04fdc7ecc959fa93484a185c4d056447036f0960d915202`；唯一变化是被 Docker 排除的初始化测试文件。关键管理服务、Blob 生命周期与 ManagementConsole 源码又在该镜像内读取并核对哈希，未把测试文件变化冒充运行代码变化。

最终冻结源码 r3 的 macOS arm64 preview 打包 exit 0，真实包内 SQLite 写入/关闭/重开与完整托管 1/1（12.74 秒，测试进程总计 12.85 秒）通过。托管 fixture 从空目录显式编译，覆盖真实 UGC 安装、客户端材料复用、管理/游玩独立、匿名拒绝、排空/停止及重启身份/default binding。356 个 renderer 文件、62 个 server 文件均匹配冻结输入；开发 addon、pnpm 元数据、清单和锁文件未改变。

产物为 `packages/web-ui/release-preview/mac-arm64/Arcadia Eternity Preview.app`；runtime `/private/tmp/arcadia-desktop-runtime-final-20261105-r3`，日志 `/private/tmp/arcadia-desktop-final-r3-package.log`。准确包内哈希、完整树摘要与 before/after proof 见 `.omo/evidence/desktop-native-validation.md` 和需求矩阵中的 desktop.sourceProof。它们验证此本地包，不代替跨平台安装/升级。

## 审查与未完成验收

源码审查记录为 `.omo/evidence/unified-server-management-code-review.md`，结论 `codeQualityStatus: WATCH`、`recommendation: APPROVE`。此前导入已提交恢复、私人 P2P 正常终局以及 ACK 异步造成回调乱序的问题已经修补并经重新查看源码；没有据此宣称所有代码、平台或部署已穷尽审查。

仍需保留：

- 5 个第三方许可证资料问题：`@better-auth/utils@0.5.0`、`@npmcli/agent@4.0.2`、`jsondiffpatch@0.7.6`、`stackback@0.0.2`、`@npmcli/redact@4.0.0`；后者声明/原始文本不一致。清单保持 `releaseReady: false`，不能正式发行。
- 修补提交的远端复验、四平台 CI、正式安装/升级和真实双设备 LAN。当前最终 Docker、macOS 预览、两组严格浏览器与 lint/类型均已有本地通过证据。
- SMTP/GitHub 真实提供商未配置，相关用户问题待答复；不得用 guest bootstrap、测试提供商或双库通过替代邮件投递/回调验收。
- 生产部署及完整容量/故障矩阵；最终 Linux arm64 Docker 重建持久化已通过，不代表所有部署场景。
- G4 战绩/积分/录像仍按原后期范围，不纳入本次管理功能完成声明。

相关实现：#273/#274、#214/#243/#244、#209/#217/#220/#222/#224；专项验收继续由 #258–#268/#272 按实际证据维护，本记录不自动关闭任何 issue。
