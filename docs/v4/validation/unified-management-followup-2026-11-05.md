# 统一管理后续验证（2026-11-05）

本轮继续 [PR #275](https://github.com/arcadia-eternity/arcadia-eternity/pull/275) 的安装、持久化故障与部署验证。代码提交 `576202830fc28b3f9840ffbdfb8f5f05147fd847` 的 [baseline 6/6](https://github.com/arcadia-eternity/arcadia-eternity/actions/runs/41949631695) 与[原生桌面 CI 4/4](https://github.com/arcadia-eternity/arcadia-eternity/actions/runs/41949631649) 全部通过，包含五种实际安装组合、十次真实 ASAR GUI 启动。证据提交 `3b0f93aa` 只修改文档与回执；该提交自动复验随后暴露了下述验收进程退出竞态。首次 `55863dbc` 安装 CI 暴露的平台问题及其修复保留如下；旧 Docker/r3 产物的来源继续见[先前验证记录](unified-management-2026-11-05.md)，不重标为新构建。

## 修复与已执行验证

| 范围               | 本轮结果                                               | 证据范围                                                             |
| ------------------ | ------------------------------------------------------ | -------------------------------------------------------------------- |
| 完整服务端         | 32 文件、327 项通过，122.99 秒，退出码 0，无未处理异常 | 真实 SQLite 与 PostgreSQL；包含新增故障测试                          |
| 数据库与编译 CLI   | 23 项与 35 项通过                                      | 双库合同；编译后初始化、管理、备份和恢复命令                         |
| 桌面与安装工具回归 | 74 通过、1 项平台限定跳过                              | 包含内容库 23 项，以及安装替换、进程清理、发布清单                   |
| macOS arm64 ZIP    | 首次安装与同版本替换后的两次 GUI 启动通过              | 真实 ASAR 主入口，正常退出；没有页面错误、console error 或 HTTP 错误 |
| 格式、lint 与类型  | 全仓 ESLint、改动 Vue 规则及完整 Web vue-tsc 通过      | 本轮修改后的源码；服务端/根类型与生产构建另有前序通过记录            |

SQLite 故障测试通过真实第二连接持有写锁触发 `SQLITE_BUSY`，通过页数上限和审计触发器在领域写入之后触发 `SQLITE_FULL`。首次账户建立、停用、授权扩展和绑定可见性共 8 次注入均完整回滚，8 次后续重试成功。这里验证的是 SQLite 页容量耗尽，未模拟操作系统磁盘耗尽。

PostgreSQL 在事务执行至审计触发器时阻塞，然后终止确切后端连接，验证账户、授权和绑定回滚及后续恢复。测试发现已借出连接的 socket error 未被 pool 监听器接收，导致事务回滚后仍发生进程未处理异常。修复只为自有连接池登记 client/pool 监听器，重复错误去重且不记录连接串或 SQL；外部池的关闭与监听所有权保持。5 项专项通过，无未处理异常；临时 PG 集群在完整回归后正常停止。

## 真实桌面应用

首次 GUI 验证发现并修复了以下问题：打包后基础内容路径仍查找开发目录；本地资源 HTTP 回退路径不匹配打包材料；无更新配置的预览包尝试读取不存在的更新文件；新内容库没有活动选择时无法直接使用官方内容开服；环境表单的连字符未按 Chromium 的 Unicode Sets 正则规则转义。

空内容库首次开服现在准备同一套官方基础材料。已有选择和未完成的准备请求继续受版本检查保护，不会被首次开服覆盖。客户端与服务端继续共享材料和工作区。

实际 ZIP 解压到专用临时安装目录，使用独立用户资料目录启动 ASAR 中的真实应用。页面操作保存玩家名称、创建源项目并把技能威力改为 77、启动托管和创建管理环境。替换同版本 ZIP 后，第二次启动验证玩家 ID、源文件哈希、工作区 ID、服务器 ID、默认绑定、有效版本及环境列表均保留。两次退出码为 0，宿主和资源端口均关闭。

最新产物 SHA-256：`3cd6a1e2b356d1fe468bbec83b1ab51ecfb13d493e4bdda494fea05fc21e67ce`。完整回执与截图位于 `/private/tmp/arcadia-desktop-gui-acceptance-r6b-20261105/`，摘要见 `.omo/evidence/unified-management-followup-2026-11-05.json`。这是同版本安装替换，尚不等于历史版本或 schema 升级验收。

首次原生 CI 发现 Linux AppImage 从 scoped npm 名推导出非法程序名，现统一配置 `linux.executableName=arcadia-eternity`；两个 macOS 的真实 GUI 还发现本地档案页隐式查询默认公网账户能力，现仅在明确选服或已有会话后查询。修复后的本地 ZIP 两次完整启动、编辑、开服和替换复验通过，外部服务 API 请求为零；编辑器仍按资源声明加载远程图片，因此不把该场景记为离线资源验收。

Windows ZIP 的首次安装暴露了压缩工具解引用 pnpm 目录链接后丢失兄弟依赖的问题，实际启动报 `chokidar -> readdirp` 缺失。现只在 Windows staging 中使用已锁定的 Builder hoister，把已有依赖图转成普通目录；不重新解析版本或联网安装。每条依赖边都核对原始物理实例，包括已选定的 peer。实际材料投影得到 445 个物理实例、719 条边，真实 chokidar 与 Better Auth 导入通过；新增循环、别名、同版本不同 peer 实例、越界与缺失检查均通过。安装/移植性联合回归 47 项通过、1 项平台限定跳过（日志 `/private/tmp/arcadia-windows-linkless-regression.log`）。NSIS 首轮安装在 300 秒超时，实体布局后的原生复验已通过；超时清理现会终止本次拥有的安装器进程树，不能证明退出时保留目录。这些本地检查随后由下述 Windows NSIS/ZIP 原生安装复验确认。

四平台 CI 增加真实 ZIP、Windows NSIS 与 Linux AppImage GUI 验证。NSIS 限定一次性 GitHub 托管运行器，使用预览应用 ID，不提权、不创建快捷方式、不自动启动；AppImage 在 Linux 上经 FUSE/Xvfb 启动其自身。清理只操作本次拥有的进程和目录；无法确认进程停止时保留材料。

## 原生安装最终矩阵

| 目标        | 实际安装物                 | 原生工具测试           | 包内完整开服   | 安装/同版本替换            |
| ----------- | -------------------------- | ---------------------- | -------------- | -------------------------- |
| Linux x64   | AppImage，经 FUSE 启动自身 | 125 通过，9 项平台跳过 | 1/1，16.647 秒 | 通过，两次 GUI             |
| macOS arm64 | ZIP 应用                   | 133 通过，1 项平台跳过 | 1/1，21.924 秒 | 通过，两次 GUI             |
| macOS x64   | ZIP 应用                   | 133 通过，1 项平台跳过 | 1/1，58.514 秒 | 通过，两次 GUI             |
| Windows x64 | NSIS 与 ZIP，分别独立验证  | 131 通过，3 项平台跳过 | 1/1，40.548 秒 | 两种格式均通过，共四次 GUI |

各目标都验证真实包内 SQLite 写入/关闭/重开；完整开服没有跳过。所有十次 GUI 正常退出，玩家/编辑文件/工作区/服务器/默认绑定/环境版本保持，页面、console、HTTP 错误和外部服务请求均为零；按声明加载的远程图片单独计数。安装物 SHA-256、构建输入摘要、CI artifact 摘要、作业 ID 与校验结果保存在 `.omo/evidence/desktop-installer-ci-2026-11-05.json`，每份下载的回执 ZIP 均核对 GitHub artifact 摘要。

NSIS 在此 Windows 托管运行器上的两次安装分别耗时 169.046 秒与 203.798 秒，整个步骤还包含 GUI 编辑/开服与退出清理。NSIS 保留；本轮确认正确性并记录耗时，未把该运行器数据推广为所有用户机器的安装速度。Windows 实际实体布局为 445 包实例/719 条边，许可扫描 589 条记录且只有下述两项阻塞。原 pnpm 布局的 574 条记录保留原统计口径。

## 安装验收进程退出竞态

文档提交 `3b0f93aa` 的 [Linux job 126998976970](https://github.com/arcadia-eternity/arcadia-eternity/actions/runs/41952341953/job/126998976970) 在强制清理测试中失败：主进程已经退出，但检查时后代进程的监听器尚未关闭。它没有进入本轮 AppImage 构建/安装；前述 `57620283` 的安装回执继续保留其原始范围。

Linux 多进程压力复现（30 个用例、同时两棵进程树、每棵 12 个实际监听子进程）在旧代码下失败 8 次；报错后不到 15 毫秒便观察到端口拒绝连接。修复后相同复现 30/30 通过。新增真实父进程先退出、后代延迟 200 毫秒关闭端口的回归在旧代码下失败，修复后通过；Mac 清理/安装工具 20 通过、1 项平台跳过，Linux 清理用例 4/4 通过，包括持续监听的拒绝清理负例。

退出检查现在对所有已知监听器作有时限的关闭确认，并分别观察主进程与监听器。强制终止后默认窗口为 10 秒，确认关闭即可立即结束；退出中的 ECONNRESET 只表示需重新探测，必须最终收到连接拒绝才接受。到期仍开放或不能确认的进程继续报错并保留安装和资料目录。没有按进程名搜索/终止其他应用，也没有忽略失败或加入固定长等待。

复现数据见 `.omo/evidence/desktop-shutdown-race-2026-11-05.json`。修复后的最新远程 CI 结果记录在 [PR #275](https://github.com/arcadia-eternity/arcadia-eternity/pull/275)，本页上方的四平台回执仍固定到各自原始提交。

## 生产依赖与发行检查

Better Auth 固定升级到官方 `1.7.13`，对应 utils 使用 `0.5.1` 的完整原始 MIT 文本。只对该版本移除已审查的可选 Vitest peer 及其 peer metadata；生产物理依赖从 527 减至 430 个实例，缺失必需依赖数为 0。真实冻结安装、离线部署和源码元数据保留回归通过；开发 SQLite addon 的哈希保持不变。实际生产依赖中的 Better Auth client/handler、OTP、会话和 GitHub 状态合同通过，提供商响应仍是测试输入，不是外部投递或回调验收。

已补入 `jsondiffpatch@0.7.6` 对应上游提交的原始许可文件；测试专用 `stackback` 随 Vitest 退出生产闭包。574 个含内置 npm 的许可记录目前只剩 `@npmcli/agent@4.0.2` 缺少适用原文、`@npmcli/redact@4.0.0` 声明与文本不一致两项，`releaseReady` 继续为 false。

发布工作流统一使用已解析的确切提交、实际版本元数据和原生四平台产物。聚合前校验本次 run/attempt 的 artifact ID 与摘要；拒绝同名不同内容覆盖，publisher 同样固定到构建提交。相关清单回归通过。本轮没有触发发行工作流或上传发行物。

## HTTPS 验证与浏览器差异

真实 TLS 反代通过隔离 Docker bridge 连接非回环后端。场景覆盖精确代理信任、一次性管理登录、Secure/HttpOnly/Strict cookie、刷新保留、CSRF/Origin 拒绝、管理写入、在线备份下载和退出后凭据失效；使用临时证书和仅本次浏览器的 SPKI 信任，不改系统证书配置。

Chrome `156.0.8078.80` 存在已确认的流式响应事件缺陷：应用完整读到 EOF 后仍产生 `net::ERR_ABORTED`。独立合成响应复现 3/3，原生 JSON 与非 no-store 对照 6/6 正常；官方测试版 `157.0.8103.15` 的全部 9 项正常。依据为 [Playwright #42742](https://github.com/microsoft/playwright/issues/42742) 与 [Chromium #568852319](https://issues.chromium.org/issues/568852319)。产品继续使用有大小上限的流式读取和 no-store；验收没有忽略相同文档的取消事件。完整 HTTPS 复验已在原精确镜像 `fcb6bcc5` 上通过，耗时 26.048 秒，浏览器异常列表为空，容器/卷/网络均清理为零。结果记录于 `.omo/evidence/docker-management-https.json`；这确认了浏览器原因与 TLS 流程，随后从 `55863dbc` 的干净 Git 归档构建镜像 `sha256:daa6da7dad6a2ce655352bf7b70f2b6360ed509ab894028cc82a3cddb4d9f7f6`，双库容器重建与 PG 重启通过，完整 HTTPS 再次通过（21.573 秒、请求失败为零、资源清理为零）。确切源码与产物分别记录于 `.omo/evidence/docker-management-followup.json` 和 `.omo/evidence/docker-management-https-followup.json`；后续桌面页面/打包修复不改写该镜像来源。

可指定隔离浏览器运行：

```sh
ARCADIA_HTTPS_BROWSER_EXECUTABLE=/path/to/chrome node scripts/verify-docker-management-https.mjs IMAGE EVIDENCE_JSON DOCKER_SOURCE_EVIDENCE_JSON
```

## 尚需独立验收的范围

四平台实际安装、首次运行与同版本替换已完成。新镜像的完整 HTTPS 与双库容器重建已按上述确切提交完成。正式签名/公证、历史版本升级、真实双设备 LAN、公网部署、SMTP/GitHub 外部投递与回调仍未完成；两项上游许可资料问题仍阻止正式发行。代表性数据库故障通过不等于穷尽断电、文件系统磁盘满或所有运维故障。G4 战绩/积分/录像保持原后期范围。
