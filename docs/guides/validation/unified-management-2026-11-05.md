# 统一管理、私人约战与在线备份验证（2026-11-05）

后续数据库故障、依赖清理和真实 GUI 安装替换的结果见[后续验证记录](unified-management-followup-2026-11-05.md)。下文保留先前提交与产物的验收快照。

本记录对应 [PR #275](https://github.com/arcadia-eternity/arcadia-eternity/pull/275) 的未发行实现；本文记录的远端结果对应 [82dd37d4](https://github.com/arcadia-eternity/arcadia-eternity/commit/82dd37d4dc38bb4b48e393029be6eddf078c49c4)。测试由根任务和专项执行者运行，文档同步核对了源码、浏览器 acceptance JSON、网络摘要、Docker 记录与远端 job 状态。各测试快照、CI job、安装和生产验收分别记录。

## 先前本地回归

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

提交 82dd37d4 的 [baseline CI](https://github.com/arcadia-eternity/arcadia-eternity/actions/runs/41901443719) **6/6 成功**：changes、native-server-entry、offline-cli、native-browser-entry、management-browser-acceptance、headless-battle 全部完成，含真实双库/CLI、生产浏览器和零跳过断言。

[桌面 CI](https://github.com/arcadia-eternity/arcadia-eternity/actions/runs/41901443601) 在 attempt 2 最终 **4/4 成功**，四平台均完成实际包内 Electron SQLite 写入/关闭/重开与 full-host 1/1，full-host 均零跳过：

| 实际执行                                                                                                      | Native                            | Full-host |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------- | --------- |
| [Linux x64](https://github.com/arcadia-eternity/arcadia-eternity/actions/runs/41901443601/job/126824624566)   | 47/47                             | 13.874 秒 |
| [Windows x64](https://github.com/arcadia-eternity/arcadia-eternity/actions/runs/41901443601/job/126824624988) | 45 通过，2 项预期 POSIX-only 跳过 | 42.277 秒 |
| [Intel macOS](https://github.com/arcadia-eternity/arcadia-eternity/actions/runs/41901443601/job/126824624928) | 47/47                             | 38.942 秒 |
| [macOS arm64](https://github.com/arcadia-eternity/arcadia-eternity/actions/runs/41901443601/job/126834263448) | 47/47                             | 31.132 秒 |

arm64 首次因托管容量无法分配 runner、尚无执行步骤而取消；只重试该项，其余链接保留原实际执行，不能把 carry-over 记录写成再次运行。Windows renderer 与 afterPack 包内绝对 junction 修补均已在真实目标通过，原 strict/native gates 保持。下方 Docker/r3 本地产物仍对应其精确 sourceProof，未被重标为新的 82dd 构建。

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

## 补充本地验证：UGC 环境同步

本项使用 **82dd 产品代码 + 本次仅修正测试 fixture 的准备代码**：5 行增加/5 行删除，将已移除的 inline presentation 写入改为 v2 的 `dist/presentation.json`；没有产品代码或行为断言变化。它是补充本地实跑，不表示 82dd 原有未修正 spec 曾通过。

| 分支     | 结果                                              | 自然结算 | 媒体 / 总请求 |
| -------- | ------------------------------------------------- | -------- | ------------- |
| 正常媒体 | 1/1 通过，49.3 秒                                 | 2 回合   | 55 / 1267     |
| 缺失媒体 | 1/1 通过，51.7 秒（wall 52.32 秒），0 fail/0 skip | 3 回合   | 0 / 1164      |

两轮均保持旧技能 power=60，旧房间环境与新默认环境 ID 不同；guest 重连仍使用原房间租约并自然结束。未使用的 SWF 未请求，正常媒体 `no-store` 断言保留并通过，测试宿主/资源已清理。已读取两份 acceptance JSON；保留目录为 `packages/web-ui/test-results/ugc-environment/{with-media-82dd37d4,missing-media-82dd37d4}/ugc-environment-sync-clean-e504c-onnect-and-finish-naturally/`，含 `acceptance.json`、`network-requests.json` 和截图。

## Docker 与桌面证据范围

最终 Docker 证据为 `.omo/evidence/docker-management.json`：Linux arm64 镜像 `sha256:fcb6bcc5739ee951dd6668b6fdcf861943bfda6de99b55c67996e943b744f8b8`，Node 24.22.2、SQLite 3.53.2、PostgreSQL 17，验收 15.6 秒。两库均验证首次 builtin-server 默认绑定及 145 个物种；容器重建后 serverId/workspaceId、设置、默认绑定和版本保持，内容/资源修订一致，PG 另经数据库重启。测试容器、卷、网络均已清理。该镜像包含首次初始化、持久 retention 与最后 UI 修补，`pairedUiRefreshPending=false`。

sourceProof 记录 1,341 个输入保持一致，摘要 `sha256:33881fd68fc0dc90c04fdc7ecc959fa93484a185c4d056447036f0960d915202`；唯一变化是被 Docker 排除的初始化测试文件。关键管理服务、Blob 生命周期与 ManagementConsole 源码又在该镜像内读取并核对哈希，未把测试文件变化冒充运行代码变化。

最终冻结源码 r3 的 macOS arm64 preview 打包 exit 0，真实包内 SQLite 写入/关闭/重开与完整托管 1/1（12.74 秒，测试进程总计 12.85 秒）通过。托管 fixture 从空目录显式编译，覆盖真实 UGC 安装、客户端材料复用、管理/游玩独立、匿名拒绝、排空/停止及重启身份/default binding。356 个 renderer 文件、62 个 server 文件均匹配冻结输入；开发 addon、pnpm 元数据、清单和锁文件未改变。

产物为 `packages/web-ui/release-preview/mac-arm64/Arcadia Eternity Preview.app`；runtime `/private/tmp/arcadia-desktop-runtime-final-20261105-r3`，日志 `/private/tmp/arcadia-desktop-final-r3-package.log`。准确包内哈希、完整树摘要与 before/after proof 见 `.omo/evidence/desktop-native-validation.md` 和需求矩阵中的 desktop.sourceProof。它们验证此本地包，不代替跨平台安装/升级。

## 审查与未完成验收

源码审查记录为 `.omo/evidence/unified-server-management-code-review.md`，结论 `codeQualityStatus: WATCH`、`recommendation: APPROVE`。此前导入已提交恢复、私人 P2P 正常终局以及 ACK 异步造成回调乱序的问题已经修补并经重新查看源码；没有据此宣称所有代码、平台或部署已穷尽审查。

此快照当时仍需保留的项目如下；后续进展以上方链接为准：

- 5 个第三方许可证资料问题：`@better-auth/utils@0.5.0`、`@npmcli/agent@4.0.2`、`jsondiffpatch@0.7.6`、`stackback@0.0.2`、`@npmcli/redact@4.0.0`；后者声明/原始文本不一致。清单保持 `releaseReady: false`，不能正式发行。
- 正式安装/跨版本升级和真实双设备 LAN；本次四平台 CI 验证非发布的 staging、打包和包内宿主，不替代实际安装/升级验收。
- SMTP/GitHub 真实提供商未配置，相关用户问题待答复；不得用 guest bootstrap、测试提供商或双库通过替代邮件投递/回调验收。
- 生产部署及完整容量/故障矩阵；最终 Linux arm64 Docker 重建持久化已通过，不代表所有部署场景。
- G4 战绩/积分/录像仍按原后期范围，不纳入本次管理功能完成声明。

相关实现：#273/#274、#214/#243/#244、#209/#217/#220/#222/#224；专项验收继续由 #258–#268/#272 按实际证据维护，本记录不自动关闭任何 issue。
