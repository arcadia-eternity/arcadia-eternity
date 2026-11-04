# 统一管理、私人约战与在线备份验证（2026-11-05）

本记录对应 `codex/unified-server-management` 当前未发行工作树。测试由根任务和专项执行者运行，文档同步核对了源码、浏览器 acceptance JSON、网络摘要与 Docker 记录。没有把本地通过换算为远端 CI、四平台安装或生产上线通过；提交/PR 链接待产生后补入。

## 最终本地回归

| 范围                                                   | 结果                           | 口径                                                           |
| ------------------------------------------------------ | ------------------------------ | -------------------------------------------------------------- |
| 服务端                                                 | 29 文件，315 项通过；104.18 秒 | 使用真实 SQLite/PostgreSQL；含管理、私人环境与终局生命周期回归 |
| Web 专项                                               | 18 文件，257 项通过；14.56 秒  | 先前 3 项大厅 mock 参数断言失败已修复                          |
| 备份核心                                               | 14/14 通过                     | 真实双库、逻辑迁移、在线捕获竞争及失败恢复                     |
| 工作区 / 私有桌面 IPC                                  | 20 / 13 项通过                 | 导入持久记录、快照 stamp、owner 与材料保护                     |
| 全仓 ESLint / 根及 Web 类型检查 / production Vite 构建 | 通过                           | 测试运行所属工作树；不代表发行物已发布                         |

frozen/offline 锁文件校验通过。两项 production 浏览器场景正在接入独立 CI job，远端运行结果尚未产生。

服务端整组之后还有三处窄幅清理：未使用 client 类型导入、声明文件 glob 扩为 `.d.{ts,mts,cts}`、peer 消息显式字符串校验。随后真实 socket 私人环境回归 **7/7 通过，6.9 秒**；315 项整组结果发生在这次清理之前，没有声称它被再次运行。

测试实现包括 `bin/__tests__/server-backup.test.ts`、`packages/content-dev/test/content-workspace.test.mjs`、`packages/web-ui/electron/test/desktop-workspace.test.mjs` 及服务端/Web 对应测试目录。

## 真实 production 构建的管理页面

[management-backup.spec.ts](../../../packages/web-ui/e2e/management-backup.spec.ts) **1/1 通过，13.6 秒**。使用实际 CLI、独立数据目录及构建后的配套网站，没有请求替身或页面 store 注入。

- 匿名备份请求被拒绝；宿主一次性登录码经页面兑换。
- 准备真实固定环境，签发服务凭证；明文不进入浏览器持久存储，刷新后仅显示安全元数据。
- 创建/手动下载在线备份，宿主离线检查确认身份和材料，归档排除活动凭证；通过元数据界面撤销服务凭证。
- 重启保留 serverId/workspaceId、环境列表、仍有效的凭证元数据、撤销结果和已完成备份下载历史。
- 浏览器错误和意外 HTTP 响应均为空。该场景使用 guest 账户模式；G3 真实提供商与账户数据保留分别由提供商/存储测试承担。

原始本地产物位于 `packages/web-ui/test-results/management-backup/2026-11-04T17-57-02-036Z/`，包含 acceptance JSON、截图及实际备份文件；为避免记录凭证，trace/video 已明确关闭。该目录是测试输出，不代表已经上传到 PR 或 CI。

## 私人 Challenge 双浏览器

[personal-environment.spec.ts](../../../packages/web-ui/e2e/personal-environment.spec.ts) **1/1 通过，50.1 秒**。两个独立浏览器显式导入同一未发布 UGC 环境，使用真实队伍编辑器，在客户端玩家宿主执行。

- 首局 2 回合自然结算，同一房间再战 1 回合自然结算；两端均呈现相反且一致的胜负结果。
- 实际 UGC 媒体完成解码；两个浏览器没有页面错误或遗留错误提示。
- 279 次服务器 Worker 采样最大值为 0，服务器公开环境目录不变。
- 479 个 WebSocket 帧中没有作者模块或环境归档。建房 payload 为 1558 字节，其中个人固定引用为 972 字节；引用包含版本/规则/来源元数据，信令服没有获取执行材料。
- 终局后的结果停留、同房间再战和迟到上一局消息隔离有对应源码/测试回归；不将此两浏览器场景当作双物理设备 LAN 或所有断线场景通过。

原始本地产物位于 `packages/web-ui/test-results/personal-environment/2026-11-04T18-07-25-638Z/`，包含 acceptance JSON、`network-events.json`、截图和两端 trace。

两组 production 场景需先完成 CLI 与配套网站构建，可从仓库根目录运行：

```sh
PLAYWRIGHT_MANAGEMENT_BACKUP=1 pnpm --filter @arcadia-eternity/web-ui exec playwright test --config playwright.management-backup.config.ts
PLAYWRIGHT_PERSONAL_ENVIRONMENT=1 pnpm --filter @arcadia-eternity/web-ui exec playwright test --config playwright.personal-environment.config.ts
```

## Docker 与桌面证据范围

Docker 记录见 `.omo/evidence/docker-management.json`：实际 Linux arm64 镜像 `sha256:3b9d8724271962a36b0af0ed04ee05229a360b86015345e18276e6b990604d4f`，Node 24.22.2。SQLite 和 PostgreSQL 均完成容器删除/重建后 serverId、workspaceId 与设置保留；PG 还经历数据库重启。配套 HTML/资源和真实管理 HTTP 通过，测试容器、卷、网络已清理。

该 Docker 证据对应 build-v3 输入快照，早于最终 P2P 生命周期修补，不能标为最终代码的容器复验。此前 macOS arm64 的实际 Electron/native SQLite、preview 包和当前代码托管检查已有证据；最终完整 preview 刷新仍待完成。四平台非发布 CI（macOS arm64/x64、Linux x64、Windows x64）尚未运行通过。

## 审查与未完成验收

源码审查记录为 `.omo/evidence/unified-server-management-code-review.md`，结论 `codeQualityStatus: WATCH`、`recommendation: APPROVE`。此前导入已提交恢复、私人 P2P 正常终局以及 ACK 异步造成回调乱序的问题已经修补并经重新查看源码；没有据此宣称所有代码、平台或部署已穷尽审查。

仍需保留：

- 5 个第三方许可证资料问题：`@better-auth/utils@0.5.0`、`@npmcli/agent@4.0.2`、`jsondiffpatch@0.7.6`、`stackback@0.0.2`、`@npmcli/redact@4.0.0`；后者声明/原始文本不一致。清单保持 `releaseReady: false`，不能正式发行。
- 最终桌面 preview、四平台 CI、正式安装/升级和真实双设备 LAN。
- SMTP/GitHub 真实提供商未配置，相关用户问题待答复；不得用 guest bootstrap、测试提供商或双库通过替代邮件投递/回调验收。
- 最终代码 Docker 复验、生产部署及完整容量/故障矩阵。
- G4 战绩/积分/录像仍按原后期范围，不纳入本次管理功能完成声明。

相关实现：#273/#274、#214/#243/#244、#209/#217/#220/#222/#224；专项验收继续由 #258–#268/#272 按实际证据维护，本记录不自动关闭任何 issue。
